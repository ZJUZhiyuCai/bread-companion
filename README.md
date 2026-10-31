# 面包

面试拒信当晚，可以先说说；愿意时，再整理真实材料、复盘并练一题。

前端由用户指定的“Claude 控制”项目中的官方 Claude Opus 5.5 / high 设计与实现。Codex 负责领域规则、后端、模型/语音适配、存档和整体验证。第三轮加入有表情和动作的面包伙伴、连续语音通话与文字切换。第四轮加入直接开口打断、电话专用快速路由和更简洁的界面。选题、默认关注点和材料整理交给 agent，细节按需展开。

## 打开

双击本目录的 **启动面包.command**，或访问已运行的 [本地应用](http://127.0.0.1:3210)。它只监听本机，不是公开网站。

```sh
npm ci
npm run dev
```

本机已配置服务端 `.env.local`：

- 文字倾听：Magpie → MFAPI / Gemini 3.8 Flash（`mfapi/gemini-3.8-flash`）；电话聊天、整理、复盘和练习：万界方舟 / DeepSeek V4.1 Flash（`wanjie/deepseek-v4.1-flash-1017`）。这是本机路由中的模型标识。需要 Magpie 在 `127.0.0.1:3425` 运行。
- 播报：MiniMax Speech 2.8 HD，沿用已配置的 `Chinese (Mandarin)_Warm_Bestie`，语速 1。
- 转写：MiniMax asr-1.0；浏览器录音先在本机转为 16 kHz 单声道 WAV。

密钥只在 `.env.local`，已排除版本控制，不发往浏览器，也不传给前端设计环境。更换设备请自行建立 `.env.local`，参照 `.env.example` 配置；不要复制密钥到 `NEXT_PUBLIC_*` 变量。

无密钥演示：

```sh
AGENT_PROVIDER=mock ASR_PROVIDER=disabled TTS_PROVIDER=disabled npm run dev
```

页面会明确标识“规则演示”；文字闭环仍然可用，语音会显示不可用。Mock 是固定规则与测试案例，不声称理解任意开放话题。

生产构建与本机运行：

```sh
npm run build
npm run start
```

实际开发环境：Node.js 26.12.1、npm 11.17.0；依赖锁定在 package-lock.json。

## 可以验收的行为

- 直接写下第一句就能开始；也可以先听一小段，或直接说想复盘什么。
- 无须配置模式或材料类型：点击“看看那段回答”“留个记号”“练一题”，agent 接着已有内容处理；练习题和关注点自动准备，想改时再展开。
- 首页点“给面包打个电话”，允许麦克风后直接说：停顿会自动转写、发送、回复和播报，接着听下一句。直接开口即可中止旧回复并继续说，按钮可备用；支持静音、暂停和挂断；挂断后保留当前文字对话，也保留未发出的草稿。
- 通话切到后台或安静一分钟会暂停并关闭麦克风，需要主动继续。挂断、结束和迟到回包不会重新打开麦克风或播放。
- 文字聊天仍保留单段录音：转写可修改后再发，回复点“听”才播放。
- 卡片可改字、删栏、展开依据；保存预览里一次点击“就留下这些”，才存到当前浏览器。支持按案例删除、MD/JSON 导出和 JSON 导入。
- 改正原话或否认判断会使相关旧卡片失效；不重复要求核对已提交的文字。结束清除原始聊天，只保留已展示有效卡片的最小只读快照，仍可主动保存或导出。

具体步骤：[演示与验收路径](docs/demo.md)。测试结果、兼容矩阵和剩余限制见 [验收记录](docs/acceptance.md)。数据说明见 [数据处理](docs/data-handling.md)，架构取舍见 [实现决定](docs/decisions.md)。设计参考见 [案例研究](docs/companion-research.md)，文本模型选择及输出约束见 [陪伴模型评估](docs/model-evaluation.md) 和 [电话延迟评估](docs/natural-call-evaluation.md)，本轮心理学依据见 [电话体验研究](docs/call-research.md)。

## 验证命令

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
```

E2E 使用本机 Chrome，单独在 3211 端口启动 Mock 服务，产物写入 `.next-e2e`，不调用收费模型。端口被其他本机任务占用时，可用 `BREAD_E2E_PORT=3213 npm run test:e2e` 指定空闲端口，不关闭其他任务。Playwright 浏览器验收截图在 `output/playwright/`。

以下命令会调用本机已配置的真实模型；测试文本均为虚构。`--speech` 额外生成一条短语音样本，请按需执行：

```sh
node scripts/smoke-live.mjs
node scripts/smoke-live.mjs --speech
node scripts/evaluate-live.mjs
node scripts/evaluate-companion.mjs --app http://127.0.0.1:3210
BREAD_URL=http://127.0.0.1:3210 node scripts/evaluate-companion-holdout.mjs
node scripts/evaluate-natural-call.mjs
```

## 结构

- `domain/`：可脱离 React 的类型、运行时校验、reducer、来源版本、引文与明确意图。
- `services/`：会话控制器、React hook、媒体生命周期、IndexedDB 事务与导出。
- `server/`、`app/api/`：限流/同源/本机检查、真实及 Mock 适配器、MiniMax。
- `prompts/`：带版本号的模式提示词。
- `components/`、`app/page.tsx`、`app/globals.css`：Claude 的前端设计。
- `tests/`：取消与存档竞态、来源证据、接口及用户路径检查。

## 范围

默认临时会话。电话是网页中的轮流语音对话，不接入电话运营商；回复仍有切句、转写、模型及合成的等待；开口打断依赖本地语音检测、浏览器回声消除和播放参考过滤，嘈杂环境仍可能误判，按钮继续可用。不提供账号、云同步、自动通知、专用硬件、同时生成多个语音回合或心理诊断。服务端无正文数据库。供应商及本机 Magpie 可能有其独立保留策略，本轮未逐项核验。公开部署、真机兼容性和目标用户访谈均需要单独完成，不能以本轮工程测试代替。
