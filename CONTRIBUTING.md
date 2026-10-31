# Contributing to Bread / 参与面包

欢迎修复真实问题、改善中文对话、复现评估或完善文档。小改动直接提 PR；新的记忆、媒体采集、存储或模型调用能力，请先用 issue 说明用户收益与数据流。中文、英文均可。

## 开发环境

```sh
git clone https://github.com/ZJUZhiyuCai/bread-companion.git
cd bread-companion
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

使用 `.nvmrc` 中的 Node 版本。示例配置默认 Mock，不需要模型账号。页面中的“规则演示”标签必须保留。不要提交 `.env.local`、真实对话、录音或 `.local/` 运行日志。

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
CI=true BREAD_E2E_PORT=3213 npm run test:e2e
```

`CI=true` 使用 Playwright 自带 Chromium；不设置时使用本机 Chrome。3213 被占用时换一个空闲端口，不关闭别人的服务。E2E 使用 Mock 与合成音频，不花费模型额度。文档修改检查链接与命令；行为修改运行相关测试，跨模块改动运行完整套件。

## 一个改动应说明什么

- 用户在什么情况下遇到什么问题，修改后会发生什么。
- 实际运行的检查及其结果，未验证的范围。
- 是否改变了输入、外部传输、保存、删除、模型费用或麦克风生命周期。

优先补会失败的回归用例。不要靠删除测试、无界重试、静默换供应商或隐藏 Mock 标记“修复”问题。界面文案与样式通常只需要针对性走查，不要求凑测试数量。

## 产品与工程约定

- 用户决定是否分析、记住、保存和结束。模型只产出候选内容，不能自己确认卡片或扩大工具权限。
- 来源修订与运行代数拒绝迟到结果；停止、静音、挂断都要覆盖正在等待的请求。
- 不把合成情境分数写成心理疗效，不把 HTTP 200 写成“情商通过”。新对话评估放在 [evaluations](evaluations/README.md)，保留失败样本。
- 使用原创或有明确授权的素材。依赖和参考资料保留来源。贡献按 [MIT](LICENSE) 许可提交；不要求转让版权。
- AI 辅助贡献可以接受。说明参与的部分，由提交者核对代码、来源、依赖与测试；不要提交代理运行凭据或私有控制环境。

目录边界与产品约束见 [产品与 Harness](docs/product-harness.md)。优先事项见 [路线图](ROADMAP.md)。维护者为 [@ZJUZhiyuCai](https://github.com/ZJUZhiyuCai)，不承诺固定审阅时限。
