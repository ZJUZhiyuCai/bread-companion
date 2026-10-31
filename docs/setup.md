# 配置与运行

## 无密钥开始

按根目录 README 安装；`.env.example` 默认 `AGENT_PROVIDER=mock`、`ASR_PROVIDER=disabled`、`TTS_PROVIDER=disabled`。不需要 Magpie、MiniMax 或任何服务账号。Mock 的用途是体验和回归，不是开放话题模型。

推荐使用 `.nvmrc` 中的版本。`package.json` 的 `private: true` 只是防止误发布 npm 包，与 GitHub 仓库的公开状态无关。

## 真实模型

在 `.env.local` 中设置：

| 变量 | 作用 |
| --- | --- |
| `AGENT_PROVIDER=real` | 使用真实文字供应商 |
| `AGENT_BASE_URL` | 接入服务的 API 根路径，例如本机 `http://127.0.0.1:3425/v1` |
| `AGENT_PROTOCOL` | `anthropic` 或 `openai` 兼容协议 |
| `AGENT_API_KEY` | 接入服务的鉴权 key，仅服务端读取 |
| `AGENT_MODEL` | 你实际有权限调用的模型 ID，不同接入服务的名称可能不同 |
| `AGENT_PROCESSOR_LABEL` | 关于页向用户说明的实际处理方 |

本机测试用 `wanjie/deepseek-v4.1-flash-1017`，它是当前 Magpie 路由标识，并非要求每位贡献者购买或安装同一服务。仓库不附带 Magpie、不提供共享 key，也不会在失败时静默换供应商。

可选的 `AGENT_COMPANION_MODEL` 用于倾听，`AGENT_CALL_MODEL` 用于电话；为空时逐级继承。两者通过同一个基础端点与 key，协议和处理方标签按 `.env.example` 配置。模型需能输出本项目要求的结构化候选；标准 HTTP 兼容性不保证所有模型都适合陪伴或证据任务。

## MiniMax 语音

```dotenv
ASR_PROVIDER=minimax
TTS_PROVIDER=minimax
MINIMAX_API_KEY=your_server_side_key
MINIMAX_BASE_URL=https://api.minimax.cn/v1
MINIMAX_TTS_MODEL=speech-2.8-hd
MINIMAX_ASR_MODEL=asr-1.0
MINIMAX_VOICE_ID="Chinese (Mandarin)_Warm_Bestie"
MINIMAX_VOICE_SPEED=1
```

这是本机已测组合；账号、地区和服务支持需与你的 MiniMax 接入一致。浏览器在 localhost 可以请求麦克风。电话入口只有在文字、ASR、TTS 能力齐全时才可用；`/api/capabilities` 表示配置状态，不是供应商在线探测。

配置改变后重启服务。不要把真实 key、导出的私人卡片或录音加入 Git。详见 [数据处理](data-handling.md)。

## 常见问题

| 现象 | 检查 |
| --- | --- |
| 显示“规则演示” | `AGENT_PROVIDER` 是否仍是 `mock`；是否重启进程 |
| 电话不可用 | 文字 key、MiniMax key 与 ASR/TTS 开关；浏览器权限 |
| 文本一直失败 | 接入服务是否运行、模型 ID/协议是否正确；查看安全错误码，不粘贴密钥日志 |
| 端口占用 | 停止自己启动的旧实例，或给 Next / E2E 指定空闲端口；不要关闭其他项目 |
| Chrome 未安装 | `npx playwright install chromium`，然后用 `CI=true` 跑 E2E |
| 保存后另一台设备找不到 | 当前只存浏览器 IndexedDB；主动导出 JSON 再导入，不是云同步 |

## 在线部署

`dev` / `start` 仍绑定 `127.0.0.1`。在线版通过 `deployment/sites/` 的独立 Vinext / Worker 适配复用业务代码；配置 HTTPS 原点、签名访客 cookie、D1 共享配额与服务端 secrets，不能仅改监听地址。完整发布、迁移、验证与回退方法见 [部署指南](deployment.md)。

公网实例不能连接维护者电脑上的 `127.0.0.1:3425`。需使用已授权的 HTTPS 上游端点和该端点实际支持的模型 ID；本项目线上使用 `https://maas-openapi.wanjiedata.com/api/anthropic/v1` 与 `deepseek-v4.1-flash-1017`。它们是运营者配置，访客不能修改。
