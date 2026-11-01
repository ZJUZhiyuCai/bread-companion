# Node / SQLite 自托管

复用已有 Linux 服务器，可运行与本机相同的 Next.js 应用。当前已上线入口是 `https://bread.163-7-7-42.sslip.io`；sslip.io 为带 IP 的主机名提供自动 DNS，无需购买域名。HTTPS 由独立的 Let's Encrypt 证书提供。[服务说明](https://sslip.io/)。这依赖第三方免费 DNS 与既有服务器，不保证永久可用或每条运营商线路可达。

## 运行契约

需要 Node >=22.13（提供 `node:sqlite`）、npm、反向代理与 HTTPS。`npm ci && npm run build` 构建；以独立系统用户运行 `next start --hostname 127.0.0.1 --port 3220`。示例见 [systemd unit](bread-companion.service) 和 [Caddy host](Caddyfile.example)。不要替换其他应用的网关配置；新增独立主机，先验证配置再热重载。

服务端环境除 `.env.example` 的供应商设置，还需要：

```sh
BREAD_PUBLIC_ORIGIN=https://your-public-host.example
BREAD_VISITOR_SECRET=<至少32字符的随机值>
BREAD_SQLITE_PATH=/srv/bread-companion/private/admission.sqlite
BREAD_NODE_INTERNAL_ORIGIN=https://127.0.0.1:3220
```

配置文件只读给 systemd/root，权限 0600；systemd 把值注入独立服务进程。不要把实际值放进发布包、Git、日志、前端或命令行参数。Next 的请求对象使用内部 loopback 地址，因此 Node 启动时显式允许该内部 origin；只接受 HTTPS loopback，仍严格校验公开 Host、浏览器 Origin、SameSite 与签名 cookie。Worker 不启用这个例外。应用监听 loopback，网关保留 Host 并设置 HTTPS 转发头；麦克风权限为 `microphone=(self)`。

数据库路径必须落在 `/srv/bread-companion/private/` 内，且不能是符号链接；越界配置在打开文件或更改权限前失败。`instrumentation.ts` 在 Node 启动时打开 SQLite；Sites staging 不复制这个 Node 入口，继续使用请求级 D1 绑定。SQLite 适配器提供与 D1 相同的 `prepare/bind/run/first/batch` 接口，`BEGIN IMMEDIATE` 保证配额检查与写入原子化。仅保存匿名散列标识与租约时间，不保存聊天、音频或回复。WAL、2 秒 busy timeout、过期清理、重启后去重和数据库不可用时拒绝付费请求仍生效。

## 发布与回退

使用独立的 `/srv/bread-companion/releases/<release>`、`private/` 和 `current` 链接。上传白名单源码并核对 SHA-256；不上传开发环境 `.env.local`。先在候选目录构建，再原子切换 current 并重启 `bread-companion`。保留上一版本，回退只切回其链接并重启此服务。不要删除共享网关、个人网站、邮件服务或其他应用。

新网关主机发布前保存旧配置及 SHA-256；确保期间无人修改它。候选配置通过 `caddy validate` 才替换并 reload；失败恢复旧配置。数据库留在版本目录外，回退时保留去重与配额记录，不通过删库绕过限额。

## 验收

页面 200 不足以表示电话可用。须检查：匿名 cookie、跨域/无 cookie 拒绝、真实 ASR → 模型 → TTS、重复请求拒绝、生产浏览器播音、麦克风停止与恢复、国内外独立网络探针。模型与语音是收费上游，冒烟只使用少量合成样本。

用户已反馈免费入口“功能没问题”；尚不清楚其最终使用微信内置浏览器还是跳转后的系统浏览器。发生静默时引导在系统浏览器打开。网络探针验证不等于所有国内移动网络可靠，参见 [手机通话验证](../../docs/mobile-call-validation.md)。

## 本次发布记录

2026-11-01 发布 `20261101-mobile-seed`，HTTPS、真实 ASR → Seed → TTS 及匿名 cookie / 跨域 / 重复请求边界检查通过。个人网站 current 链接未变化，邮件服务保持 active。共享网关只追加面包的独立主机；未修改 caizhiyu.com DNS、页面或权限。

五个国内 Globalping 探针均为 HTTPS 200：深圳、武汉、广州、成都、上海，首个 HTML 完整下载约 1.48–3.92 秒。包含联通及云服务网络，仍不能代表所有手机线路或长期可用性。原 Sites 入口继续保留。

用户确认手机功能正常、但认为 Seed 等待过长后，发布 `20261101-deepseek-empathy`，切回关闭思考的 DeepSeek Flash 和 v18 同理心提示词。候选在独立目录构建，切换时只重启面包服务。

最终版本 `20261101-deepseek-final` 同时加入数据库路径边界，MiniMax 连接入口改为官方 `https://api.minimaxi.com/v1`，完整语音链路及准入检查通过。Sites v12 继续使用其已验证的原 MiniMax 入口。
