<img src="public/brand/bread-logo.svg" width="146" height="64" alt="面包 Bread" />

# 面包 · Bread

**把复杂留给 agent，把温暖留给用户。**

收到拒信的那个晚上，先说说。想复盘时，再把真实材料整理成一张卡片、练一道题。

[English](README.en.md) · [快速开始](#快速开始) · [产品与 Harness](docs/product-harness.md) · [竞品对标](docs/competitive-benchmark.md) · [路线图](ROADMAP.md) · [参与贡献](CONTRIBUTING.md)

[![Checks](https://github.com/ZJUZhiyuCai/bread-companion/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ZJUZhiyuCai/bread-companion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)

![面包首页：毛绒伙伴、灵动眼睛和红色座机](docs/assets/bread-home.png)

*实际本机界面。真实语音需服务端配置；无密钥启动会清楚标为规则演示。*

## 它能做什么

- **一个会回应的小伙伴。** 毛绒身体、稳定注视的玻璃眼睛，能回应摸头；休息时也保留完整眼神，减少动态时保持安静。
- **拿起红色电话。** 漆红机身、象牙转盘与黄铜细节；点座机即可拨号，接通后听筒抬起，传来温暖闺蜜的声音，默认开场从本地播放。
- **直接开口或打字。** 不填情绪标签，不先选模式；面包用简短中文回应。
- **自然插话。** 网页电话按停顿接话；面包在想或在说时可以直接开口打断，也能静音、暂停、挂断。
- **想整理时再整理。** 贴材料、留个记号、看回答、练一题；题目与关注点由 agent 准备。
- **每个判断能回到原话。** 卡片可以改、删、否认和重做；原话纠正后旧引用失效。
- **保存由你决定。** 卡片预览确认后才写入当前浏览器，支持 Markdown / JSON 导出和 JSON 导入。
- **失败有退路。** 原话旁重试不重复发话；超时、停止、结束和迟到结果由控制器处理。

这是 **0.2.1 预览版、本机单用户应用**。有界上下文不是跨天关系记忆；当前没有账号、云同步或公网多用户服务。下一阶段优先改善连续记忆、回复质感和语音首响，而不是增加配置表单。见 [我们与领先产品的差距](docs/competitive-benchmark.md)。

## 快速开始

建议使用 [.nvmrc](.nvmrc) 中的 Node.js 版本；已安装对应 Node 时可跳过 `nvm use`。

```sh
git clone https://github.com/ZJUZhiyuCai/bread-companion.git
cd bread-companion
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

打开 **http://127.0.0.1:3210**。默认 Mock 无需账号和密钥，能体验文字、材料、卡片与练习流程；它是固定规则演示。已有 `.env.local` 时保留自己的配置。

生产模式：

```sh
npm run build
npm start
```

macOS 也可以双击 `启动面包.command`。它只在本机启动应用。仓库公开不等于应用已部署到公网。

### 接入真实文字与语音

配置都在服务端，用户不需要填写模型表单。完整变量与步骤见 [配置指南](docs/setup.md)。

| 能力 | 当前验证过的配置 |
| --- | --- |
| 文字 / 电话回复 / 复盘 | 本机 Magpie，Anthropic 兼容协议，DeepSeek 路由 `wanjie/deepseek-v4.1-flash-1017` |
| 语音转写 | MiniMax `asr-1.0` |
| 语音合成 | MiniMax `speech-2.8-hd`，`Chinese (Mandarin)_Warm_Bestie` |

这些是维护者已测路由，不是所有服务商都通用的模型 ID。也可按适配器协议配置自己的接入服务。密钥只放 `.env.local`，不要放进 `NEXT_PUBLIC_*`。

## 如何判断它真的好用

我们公开测试口径和失败样本，不把请求成功当作“情商通过”。

| 检查 | 已有证据 |
| --- | --- |
| 工程回归 | 155 项单元/集成、27 条浏览器流程；CI 跑类型、测试、构建与 Chromium |
| 中文对话复测 | v14：8 个情境、16 轮接口调用，含一条控制层道别；完整响应中位 **1.165 s**、p90 **1.477 s**；未测首 token |
| 语音链路 | v0.2 虚拟麦克风实测：固定开场 **0.240 s**；两轮说完至回复出声 **4.202 / 3.275 s**；开口至停止旧声 **362 ms** |
| 仍然会失败的体验 | 明确道别已有窄范围规则；仍有套话、补写细节和未请求的建议。调参前后原始合成样本全部保留 |

样本量小、环境特定，以上不是 SLA 或跨产品排名。物理麦克风、外放、蓝牙和手机真机仍待测。详见 [本轮视觉与交互验收](docs/material-identity-validation.md)、[此前语音验收](docs/living-companion-validation.md)、[对话评估](evaluations/README.md) 和 [竞品对标](docs/competitive-benchmark.md)。

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
CI=true BREAD_E2E_PORT=3213 npm run test:e2e
```

正常测试不调用付费模型。单独进行真实对话评估：

```sh
npm run eval:companion -- --dry-run
# 以下命令会调用你配置的真实服务，可能产生费用
npm run eval:companion -- --live --app http://127.0.0.1:3210
```

## 架构

```mermaid
flowchart LR
  UI[文字 / 电话 / 材料] --> C[会话控制器]
  C --> H[有界上下文与运行版本]
  H --> API[本机同源 API]
  API --> LLM[文本供应商]
  API --> Speech[MiniMax ASR / TTS]
  LLM --> V[结构 / 风格 / 原文引用校验]
  V --> C
  C --> UI
  C --> Preview[用户预览确认]
  Preview --> Store[浏览器 IndexedDB / 导出]
```

模型产出内容候选；确认、存储、权限、超时和取消由应用控制。

| 目录 | 职责 |
| --- | --- |
| `domain/` | 类型、校验、reducer、来源版本与原文证据 |
| `services/` | 会话与媒体生命周期、存档事务、导出 |
| `server/`、`app/api/` | 供应商适配、同源边界、限流、截止时间与去重 |
| `prompts/` | 有版本的倾听、分析与电话提示词 |
| `components/`、`app/` | Claude 设计的界面与面包形象 |
| `tests/`、`evaluations/` | 工程回归、合成情境和可复现的评估记录 |

[完整文档导航](docs/README.md) · [数据处理](docs/data-handling.md) · [安全策略](SECURITY.md) · [更新记录](CHANGELOG.md)

## 贡献与许可

欢迎从中文对话失败案例、真机语音复现、可控记忆或文档入手。先看 [贡献指南](CONTRIBUTING.md)、[路线图](ROADMAP.md) 和 [社区约定](CODE_OF_CONDUCT.md)。

前端由官方 Claude Code 协作完成，Codex 负责后端、集成与验证，维护者负责项目取舍；原稿哈希与接入差异保留在设计溯源中。

**[MIT License](LICENSE)** © 2026 Zhiyu Cai and Bread contributors。角色与语音来源见 [素材说明与生成提示词](docs/living-companion-assets.md)，依赖及素材权利范围见 [Third-party notices](THIRD_PARTY_NOTICES.md)。
