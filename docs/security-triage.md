# CodeQL 初次扫描处置记录

日期：2026-10-31。审阅应用代码基线：`571e8462664a1aaca2689a2381c506d0340f5789`；`d14bf27` 仅调整 CI 触发条件。

GitHub CodeQL 默认查询集采用 `remote_and_local` 威胁模型，首次扫描完成后产生 12 条提示。以下逐项核对输入来源、可控方和请求终点；按当前单机、单用户边界判为误报。保留扫描及规则，不通过关闭规则消除提示。此结论不是全项目安全认证；若部署方式或配置权限改变，必须重新评估。

## 配置 URL 与出站请求

| 提示 | 位置 | 输入来源与判断 |
| --- | --- | --- |
| [#2](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/2)、[#3](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/3)、[#5](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/5)、[#7](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/7) | `scripts/evaluate-companion-holdout.mjs`、`evaluate-live.mjs`、`evaluate-natural-call.mjs`、`evaluate-upgrade.mjs` | 独立 CLI 由运行者通过 `BREAD_URL` 选择测试服务。脚本不接受 HTTP 请求，不代表另一个用户执行请求，没有从低权限用户到高权限服务的 URL 传递。 |
| [#4](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/4)、[#6](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/6) | `scripts/evaluate-companion.mjs` | 运行者通过 `--app` 或本机 `.env.local` 中的 `AGENT_BASE_URL` 选择评估目标；没有从对话或模型回复读取目标地址。配置者本就能选择并调用该服务。 |
| [#8](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/8)、[#9](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/9)、[#10](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/10) | `scripts/smoke-live.mjs` | 同一独立 CLI 以运行者提供的 `BREAD_URL` 调用能力、文字和可选语音端点。它不属于应用请求处理路径。 |
| [#11](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/11)、[#12](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/12) | `server/providers/speech.ts` | 基地址只来自服务端 `MINIMAX_BASE_URL` 或官方默认地址，分别拼接固定 `/t2a_v2`、`/speech_to_text`。HTTP 用户输入、录音及模型回复不能覆盖它；请求禁止重定向。TTS 使用校验后的十六进制音频，不下载模型返回的任意 URL。 |

这些提示均为 `js/request-forgery`。分类依据是当前不存在扫描器假设的跨权限配置入口，而不是“目标通常可信”。**配置权限本身是可信边界**：不要把供应商地址作为面向其他用户的设置，不要替不可信第三方运行这些 CLI。后续若添加多租户、远程配置、用户自带端点或服务代执行评估，必须增加适配该部署的 URL / 网络访问策略并重新打开相关审阅。

当前公开推荐的 `scripts/benchmark-companion.mjs` 另外限制为不含 URL 凭据的 loopback 地址，并要求显式 `--live` 才会产生真实调用；这不改变旧 CLI 的操作者信任模型。

## 演示计时器

[#1](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/1) 为 `js/resource-exhaustion`，落在 `server/providers/mock-agent.ts` 的 `setTimeout(this.delay)`。

实际应用中唯一构造入口是 `app/api/agent/turn/route.ts` 的 `new MockProvider(c.mockDelay)`。`server/config.ts` 已将 `MOCK_DELAY_MS` 转为数字，再限制到 0–5000 ms；无效值使用 400 ms 默认值。该字段不来自 HTTP 请求。取消信号也会清除计时器。

直接导入 `config()` 的边界检查结果：

| 环境值 | 返回延迟（ms） |
| --- | ---: |
| `99999999999999` | 5000 |
| `Infinity` | 5000 |
| `-Infinity` | 0 |
| `-1` | 0 |
| `NaN` | 400 |
| `80` | 80 |

因此当前路径没有告警所描述的无界计时值。若以后新增构造入口、移除限制或允许请求控制此参数，应重新审查。

## 处置原则

上述 12 条使用 GitHub 的 `false positive` 分类归档，并逐条写入来源和判断；没有宣称修复了 12 个可利用漏洞。历史提示、原始扫描和解释均保留。新增代码继续接受 CodeQL、依赖更新与密钥扫描，私密漏洞报告入口见 [SECURITY.md](../SECURITY.md)。


## 0.4.0：公开托管后的重新审阅

2026-11-01，PR #8。新增在线 smoke CLI 和 Worker 配置上下文触发 [#20](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/20)、[#21](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/21)、[#22](https://github.com/ZJUZhiyuCai/bread-companion/security/code-scanning/22) 三条 `js/request-forgery` 提示，已重新按公开部署边界审查，而非沿用“仅单用户”的旧理由：

- `scripts/smoke-online.mjs:20` 的目标只来自明确运行该 CLI 的操作者 `--origin`。它要求精确 HTTPS origin 与 `--live`，拒绝重定向；不属于 Worker 打包的应用目录，没有 HTTP 路由启动它，不替访客选择地址或执行测试。
- `server/providers/speech.ts:7,41` 的 `miniBaseUrl` 只来自 `serverEnv().MINIMAX_BASE_URL` 或官方默认值。在线 `serverEnv()` 读的是 `deployment/sites/worker.ts` 传入的 Cloudflare **平台 env 绑定**，没有从 Request、URL、headers、FormData、模型或对话复制字段。生产配置只由拥有站点的运营者通过原生 secret/config 工具设置。
- 转写仅接受音频和请求标识，合成 schema 只接受 run 元数据与 text；访客不能提交 endpoint、key 或环境配置。手动重定向 3xx 直接失败，没有带凭据跟随到另一地址。已有两个测试覆盖 agent/ASR/TTS 的此行为。

所以这三条仍属于操作员配置被 local-source 威胁模型标为不可信，而当前产品不存在相应的低权限配置入口；按 false positive 分类保留判断。没有关闭 CodeQL、降低严重级别阈值或忽略目录。若增加 BYO endpoint、远程配置、用户脚本或工具代执行 CLI，必须重新打开审阅并施加网络目的地策略。此结论只覆盖这些具体数据流，不是公开部署的整体安全认证。
