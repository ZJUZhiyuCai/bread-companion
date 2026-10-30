# 面包

面试拒信当晚，可以先说说；愿意时，再整理真实材料、复盘并练一题。

前端由用户指定的“Claude 控制”项目中的官方 Claude Opus 5.5 / high 设计与实现。Codex 负责领域规则、后端、模型/语音适配、存档和整体验证。设计概念是“深夜还亮着的面包房”。

## 打开

双击本目录的 **启动面包.command**，或访问已运行的 [本地应用](http://127.0.0.1:3210)。它只监听本机，不是公开网站。

```sh
npm ci
npm run dev
```

本机已配置服务端 `.env.local`：

- 文本：Magpie → 万界方舟 / DeepSeek V4.1 Flash（`wanjie/deepseek-v4.1-flash-1017`）。需要 Magpie 在本机 `127.0.0.1:3425` 运行。
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

- 三入口：说几句、先看欢迎词并主动播放、直接复盘。
- 倾听、记号卡、来源核对与修正、事实/推断/未知、一次练习。
- 停止、结束、取消录音及丢弃迟到结果；转写修正后才发送，音频不自动播放。
- 卡片编辑/删条目/确认；保存预览；本浏览器 IndexedDB 存档、按案例删除、MD/JSON 导出、JSON 导入。
- 来源修正或否认判断使相关卡片失效；只有有效确认版本能保存。结束后只保留最小只读确认快照。

具体步骤：[演示与验收路径](docs/demo.md)。测试结果、兼容矩阵和剩余限制见 [验收记录](docs/acceptance.md)。数据说明见 [数据处理](docs/data-handling.md)，架构取舍见 [实现决定](docs/decisions.md)。

## 验证命令

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
```

E2E 使用本机 Chrome，单独在 3211 端口启动 Mock 服务，产物写入 `.next-e2e`，不调用收费模型。Playwright 浏览器验收截图在 `output/playwright/`。

以下命令会调用本机已配置的真实模型；测试文本均为虚构。`--speech` 额外生成一条短语音样本，请按需执行：

```sh
node scripts/smoke-live.mjs
node scripts/smoke-live.mjs --speech
node scripts/evaluate-live.mjs
```

## 结构

- `domain/`：可脱离 React 的类型、运行时校验、reducer、来源版本、引文与明确意图。
- `services/`：会话控制器、React hook、媒体生命周期、IndexedDB 事务与导出。
- `server/`、`app/api/`：限流/同源/本机检查、真实及 Mock 适配器、MiniMax。
- `prompts/`：带版本号的模式提示词。
- `components/`、`app/page.tsx`、`app/globals.css`：Claude 的前端设计。
- `tests/`：取消与存档竞态、来源证据、接口及用户路径检查。

## 范围

默认临时会话，不提供账号、云同步、自动通知、专用硬件、全双工或心理诊断。服务端无正文数据库。供应商及本机 Magpie 可能有其独立保留策略，本轮未逐项核验。公开部署、真机兼容性和目标用户访谈均需要单独完成，不能以本轮工程测试代替。
