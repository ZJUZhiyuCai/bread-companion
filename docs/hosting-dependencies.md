# 在线托管依赖复核

2026-11-01，0.4.0。范围为 `deployment/sites/package-lock.json`，同时检查开发与运行依赖；不是对互联网上所有组件或所有部署方式的安全保证。[审计摘要](hosting-dependency-audit.json) 保留前后数量和剩余路径。

从模板起点的 31 条受影响包记录（9 高、22 中）降到 20 条（0 高、20 中、0 严重）。依赖链会令同一根问题计入多个包，不能称为修复了 11 个独立可利用漏洞。

| 组件 | 当前锁定版本 | 处理 |
| --- | --- | --- |
| Vinext | 1.4.0 | 更新框架及其 OG / 图像依赖 |
| Vite | 8.3.5 | 包含已披露的开发服务器修复 |
| Cloudflare Vite 插件 / Wrangler | 1.66.0 / 4.154.0 | 按插件所用 Wrangler 精确对齐，更新 Miniflare、WebSocket 和 HTTP 依赖 |
| Worker 类型 / RSC 插件 | 5.20261023.1 / 0.5.37 | 使用框架兼容的 peer 版本 |
| Miniflare → sharp | 0.35.5 | 将已有 override 更新到 librsvg 修复版 |
| Satori → fflate | 0.7.5 | 使用同一 0.7 系列的 ZIP64 修复版 |

原始依据：[Vite 开发服务器路径问题](https://github.com/advisories/GHSA-rq7h-c2jc-7f22)、[WebSocket 内存问题](https://github.com/advisories/GHSA-58qx-3vcg-4xpx)、[sharp / librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[fflate ZIP64](https://github.com/advisories/GHSA-px8p-9vwx-vf98)。未用 `--force`、`--legacy-peer-deps` 或全局批准安装脚本。

## 仍需跟踪的两类开发工具问题

- ESLint / TypeScript ESLint 的 `minimatch`：glob 输入可导致资源耗尽，官方修复在 11.0.1；当前调用方依赖旧 major。它用于本机源码 lint，网站没有暴露执行 lint 或提交 glob 的端点。此轮没有强制跨 major 替换全部消费者；跟踪上游兼容升级。[公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- Drizzle Kit → `@esbuild-kit/core-utils` 的 esbuild 0.18.20：漏洞针对开发服务器。本项目生产 Worker 不运行 esbuild serve，也不把 Drizzle Kit 暴露为服务；迁移只由维护者执行。自动修复建议会把 Drizzle Kit 降到 0.18.1，未采纳。[公告](https://github.com/advisories/GHSA-67mh-4wv8-2f99)

上述工具不在应用请求处理路径。若未来开放构建、lint、开发服务器或用户定义迁移，必须重新评估，不能沿用本轮结论。发布产物不包含 node_modules；线上只运行构建后的 Worker 与静态资产。
