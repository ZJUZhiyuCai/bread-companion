# 开源仓库建设与维护

目标是让第一次看到项目的人能理解、运行、核验和贡献。项目仍是早期预览，不用成熟仓库的包装替代长期维护。

## 参考了什么

- [FastAPI](https://github.com/fastapi/fastapi)：清楚的项目价值、短安装路径、例子、文档与贡献入口。借鉴信息顺序，没有复制文案或性能宣称。
- [Dify](https://github.com/langgenius/dify)：多语言入口、产品截图、可运行路径、架构与社区入口。只学习组织方式，没有复制代码、品牌或其许可证。
- [GitHub 社区规范](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories)：README、许可证、贡献说明、行为准则、问题模板与安全策略。

## 面包采用的结构

| 入口 | 内容 |
| --- | --- |
| README / README.en | 中英文简介、实际截图、无密钥启动、能力、真实指标与限制 |
| LICENSE / package metadata | 标准 MIT；依赖保留各自许可证 |
| docs / evaluations | 当前文档与历史分开；场景、完整合成输出、评审和竞品一手来源 |
| CONTRIBUTING / CODEOWNERS | 可复现开发流程、范围边界、明确维护者 |
| SECURITY / CODE_OF_CONDUCT | 私密漏洞通道、可执行的协作规则，不编造客服时限 |
| Issue / PR templates | 用户问题、复现证据、数据与行为变更；不要求上传私人聊天 |
| CI / Dependabot | 无密钥类型/单元/构建/浏览器检查；固定 Actions SHA、最小默认权限、依赖更新建议 |
| ROADMAP / CHANGELOG | 已实现与待做分开，优先级有可检验目标 |

## 发布检查

公开前扫描全部可达 Git 历史与新文件，而不只检查最新 diff。2026-10-31 的历史预检覆盖 281 个 blob，未匹配当前配置的长密钥或常见私钥/令牌模式；匹配扫描不能证明所有敏感信息绝对不存在。`.env.local`、运行日志、浏览器会话和用户的无关工作文件均不纳入。

只发布合成评估输入和必要输出；不上传控制项目、SSH 配置、供应商凭据或私人录音。测试截图是无聊天内容的实际首页。GitHub 可见性变更遵循 [官方说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)。

发布后检查匿名访问、许可证识别、主分支 CI 和安全功能实际状态。安全配置由仓库管理端维护；不要因为目录里有 SECURITY.md 就声称已完成漏洞扫描。代码公开不代表应用已公网部署。

本次另用仅含待发布文件的干净目录验证 `npm ci`、137 项单元/集成与生产构建；未复制本机私有配置，使用 `.env.example` 后启动的能力端点为 Mock、语音禁用，文字接口返回 200。这验证了外部贡献者无需维护者密钥即可运行的路径。真实模型评估另走显式 `--live`，不会混入普通 CI。
