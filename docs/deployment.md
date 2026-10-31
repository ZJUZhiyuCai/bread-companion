# 在线体验与部署

面包保留本机 Next.js 开发方式；在线版本通过 **Sites 的 Vinext / Cloudflare Worker** 适配运行相同界面和业务层。在线端点直连已授权的 HTTPS 模型供应商，不能使用维护者电脑上的 Magpie loopback 地址。访客不用配置模型，也不用注册应用账号。

## 构建与发布

`deployment/sites/` 保存版本化的 Worker 适配、D1 schema / migration、依赖锁与 staging 脚本。使用已安装 Sites 插件的官方 starter 和发布工具：

```sh
node deployment/sites/stage.mjs --plugin-root /absolute/path/to/sites/plugin
```

脚本只复制明确列出的应用目录到忽略的 `output/sites/bread-companion/`，拒绝符号链接，不复制 `.env.local`、`.local/`、私人对话或工作区的其他项目。`bread-source-manifest.json` 列出全部应用文件 SHA-256。首次生成的目录依照 Sites 官方流程安装；后续仅在锁文件变化时重新安装。根目录 `npm run build` 继续构建 Next 版本。

在生成目录运行 Sites 官方 build / source workflow。source helper 负责推送精确来源与打包；原生 Sites 工具保存与该 commit 一致的版本，然后部署。不要手工拼接 worker 上传 API，也不要把源仓库地址当作体验网址。`.openai/hosting.json` 的项目 ID 是公开标识而非密钥；**fork 部署必须使用自己拥有的站点 ID**，不得继续向维护者站点发布。站点只创建一次，后续沿用 ID 和版本。

本地 Worker 预览使用生成目录中的 `npm start -- --port 3216`。首次应用 `drizzle/0000_request_admission.sql` 后才能验证在线共享准入；只对未应用的迁移执行 Wrangler 本地迁移，不能每次启动重复创建表。生产迁移由 Sites 发布流程应用，业务请求不会创建/修改 schema。

## 服务端配置

所有实际值通过 Sites 原生环境变量工具保存，密钥标为 secret。源码、前端 bundle、`.openai/hosting.json` 与构建产物不含密钥。

| 配置 | 用途 |
| --- | --- |
| `BREAD_PUBLIC_ORIGIN` | 实际 HTTPS 站点 origin，不带尾斜线或路径 |
| `BREAD_VISITOR_SECRET` | 至少 32 字符的随机服务端 secret；用于短期匿名 cookie 签名 |
| `DB` | Sites D1 绑定，迁移见 `deployment/sites/drizzle/` |
| `AGENT_PROVIDER / PROTOCOL / BASE_URL / API_KEY / MODEL` | 真实文本服务；本次为万界方舟 Anthropic 兼容 DeepSeek Flash |
| `AGENT_PROCESSOR_LABEL` | 关于页向访客展示的真实处理方 |
| `ASR_PROVIDER / TTS_PROVIDER / MINIMAX_*` | MiniMax ASR 与 Warm Bestie，变量解释见 `.env.example` |

运行时通过 AsyncLocalStorage 将每个 Worker 请求的绑定和配置传入后端，不修改共享的 `process.env`。改变 secret 后发布新部署以应用环境 revision。不要把 key 写进 shell 参数、构建配置或 `NEXT_PUBLIC_*`。

## 并发、失败与成本边界

| 层 | 当前限制 / 行为 |
| --- | --- |
| 访客 | 12 小时 HttpOnly、Secure、SameSite=Strict 签名 cookie；POST 验证精确 Origin 与 Host，不信任转发 Host |
| 共享总预算 | 滚动 24 小时 1,200 次已准入 API 请求；每访客 360 次；全站每分钟 120、每访客 60 |
| 共享并发 | 全站 12、每访客 2；电话/倾听/ASR/TTS 各 4，复盘分析 2 |
| 进程内限流 | 每能力最多 3 个活跃调用、每分钟 30、每小时 240；跨实例仍受 D1 共享限制 |
| 请求体 | 每实例最多 4 个读取器、10 秒读取上限；JSON 128 KiB；WAV 65 秒上限加 8 KiB multipart 包装 |
| 租约 / 去重 | 120 秒活跃租约，完成/取消后释放；重复 ID 24 小时拒绝，不重放正文或再次计费 |
| 数据库不可用 | 2.5 秒准入上限，拒绝新调用；不静默退回进程内计费 |
| 供应商故障 | 每能力连续 3 次暂态错误后熔断 15 秒，再只放一个探测；用户取消不算供应商故障 |
| 自动行为 | 固定欢迎文件与麦克风准备并行；能力与本地存档并行；没有付费模型竞速或网络盲重试 |

ASR、文本和 TTS 分别计入请求数；一次电话回合通常是三次请求。模型结构/风格修复仍最多再调用一次，故这些额度不是精确货币预算或 token 预算。访客可以清 cookie 取得新身份；全站上限仍约束总体调用。共享准入是原子 SQL batch，避免多个 Worker 同时读到旧余额后各自放行。熔断与请求体读取器为进程局部，不能视作全局 DDoS 防御。

D1 保存请求/访客的散列标识、能力与时间戳，不保存聊天或音频。24 小时到期记录在下一次准入时清理；没有流量时物理保留可能更久。详见 [数据处理](data-handling.md)。

## 验证与回退

发布前运行根目录 typecheck、unit、模型资产检查、build 和浏览器流程；另外构建并实际打开 Worker 候选。发布后核对原生部署成功，再使用合成文字/音频验证 HTTPS capabilities、签名 cookie、文本、ASR、TTS、重复/跨站拒绝与 D1 租约回收。不能用 Mock 回包代表真实链路成功。

若新版本异常，沿用同一站点，部署已验证的上一保存版本；环境变量和数据库迁移独立于源码回退，必须核对兼容性。当前初版 migration 仅追加共享计数表；未来 schema 修改需新增迁移，不能编辑已应用文件。停用付费服务可通过 runtime provider 开关并重新部署，不删除用户浏览器存档。

此次实际结果及未测设备见 [0.4.0 验证](craft-online-validation.md)。没有物理手机、蓝牙或外放回声实测时，不宣称它们已通过。
