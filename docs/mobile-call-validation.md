# 手机收音与陪伴回复验证 · 2026-11-01

用户报告的设备环境是 **鸿蒙、微信内置浏览器**：通话接通后，说话没有显示正在收音。原回复“又出岔子了？”也容易让人感到被责怪。本次围绕这两个问题调整；没有把桌面模拟当作鸿蒙真机验收。

## 回复与模型选择

在相同的六个合成场景下交错请求，比较短电话回复。计时是完整 HTTP 响应耗时，包含供应商与网络；不是模型首 token、用户声学等待时间或有统计代表性的 SLA。原始结果保留无内容、超时等失败；HTTP 200 不等于情商合格。

| 模型 / 设置 | 有内容的合法 JSON | 完整响应中位数 | 最慢 |
| --- | ---: | ---: | ---: |
| DeepSeek Flash，原提示词 | 6/6 | 1.310 秒 | 1.428 秒 |
| DeepSeek Flash，首轮修订 | 6/6 | 1.328 秒 | 1.440 秒 |
| GLM 5.3 Flash | 5/6 | 8.002 秒 | 10.427 秒 |
| Gemini 3.8 Flash / minimal | 6/6 | 7.733 秒 | 9.788 秒 |
| MiniMax M3.1 Flash | 6/6 | 4.619 秒 | 6.901 秒 |
| Seed 2.1 Pro / disabled | 6/6 | 2.189 秒 | 3.064 秒 |
| **Seed 2.1 Pro / minimal** | **6/6** | **2.068 秒** | **3.480 秒** |
| Seed 2.1 Pro / low | 6/6 | 8.646 秒 | 13.754 秒 |

前四种替代路线通过本机 Magpie；Seed 按用户指定直连 Tokendance。因此模型、网关与链路差异混在这些观测里，不能把速度差异全归因于模型本身。Tokendance 的上游目录实际包含 `seed-2.1-pro`，本机 Magpie 当时的目录没有它。本次未修改 Magpie 的全局路由。

初次候选的文字倾听和电话采用 Tokendance `seed-2.1-pro`，OpenAI Chat Completions，`thinking.type=enabled`、`reasoning_effort=minimal`。`low` 会明显增加这组短回复的延迟。首轮 minimal 返回的 reasoning token 为 0；只承诺发送并观察到该参数与用量，不推断内部思考机制。[火山引擎参数文档](https://docs.volcengine.com/docs/ark/model-parameter-support?lang=zh)列出 Seed 2.1 Pro 的相应档位。

分析、整理、复盘和练习继续使用原 DeepSeek 路由；MiniMax Warm Bestie 不变。独立陪伴端点必须有独立密钥，缺失时不会把分析服务的密钥发送给新主机。

提示词增加：不强调“又”来责怪用户；不把“小问题”升级为失败；不编造努力或经历；不以“先别……”训导用户。可观察风格校验会拒绝特定的责怪式开头，最多修复一次，仍受原请求超时约束。

**改善有限，不是情商认证。** Seed 的首轮仍出现了无依据的“你已经很用力了”；最终独立八场景中仍有“而已”“先缓口气”等淡化或建议倾向。最终 Harness 的 17 个真实 API 场景均返回成功，其中两个三轮对话实际带入历史；不代表每条都足够细腻。应继续观察真实用户反馈，不用更多固定安慰句掩盖问题。

证据：[五路首轮比较](evaluation/mobile-model-comparison.json)、[Seed 三档比较](evaluation/seed-model-comparison.json)、[最终八场景](evaluation/seed-holdout.json)、[最终 Harness 多轮结果](evaluation/mobile-harness-quality.json)。比较阶段为 v16；Seed 测试提示词是 `bread-2026-11-01-v17-mobile-seed`。可用 `BREAD_URL=http://127.0.0.1:3210 node scripts/evaluate-natural-call.mjs` 重跑当前已配置服务；这会产生真实模型调用费用。

## 麦克风恢复

- 每 500 毫秒核对采集健康；音轨持续被浏览器静默 2 秒，或 5 秒没有 PCM 帧，会关闭旧音轨并进入可重试状态。
- 有帧但持续 8 秒是数字零时，只提示“还没收到声音”，不把用户安静误判成故障，也不上传静音调用 ASR。
- 微信环境的故障提示明确指向右上角“在浏览器打开”，并请求系统浏览器麦克风权限。正常环境继续支持原通话，不一律禁止微信。
- 正常倾听的最低能量门槛从 RMS 0.009 降为 0.002，并增加对直流、点击和高频噪声的检查；开口打断保留更严格的 0.009 门槛与回声检测。16 / 44.1 / 48 kHz 轻声样本有回归测试。
- 倾听时可以直接重新连接麦克风；每个阶段都能挂断并改成打字。不会自动反复请求权限或重传用户音频。

[WebKit 官方说明](https://webkit.org/blog/7763/a-closer-look-into-webrtc/)指出音轨被静默时可以继续返回无声帧；这一机制值得防护，但不是鸿蒙故障原因的证据。随后用户在免费入口试用后明确反馈“功能没问题”。这验证了用户此次使用可行，但没有提供是否从微信跳转系统浏览器、权限状态或微信版本，不能据此声称所有鸿蒙微信环境都兼容。

## 已执行验证

- 209 项单元/集成测试，包括真实 SQLite 双连接去重、并发和回滚。
- 47 条浏览器流程：首轮 45 条成功、2 条因新测试的 alert 定位不唯一失败；定位到通话区域后，相关 6 条重测全部成功。包含手机尺寸下静默、采集停滞、重连、挂断、文字回退及既有自然打断流程。
- 本机 Next 生产构建与 Sites Worker 构建通过；5 个真实 API 模式成功，分析模型保持原路由。
- 手机尺寸下，以合成中文音频输入实际浏览器 AudioWorklet，真实 MiniMax ASR → Seed → MiniMax TTS 两轮均成功。用户音频末尾到回复开始播放约 5.155 / 4.651 秒；打断约 362 毫秒。记录见 [浏览器实测](evaluation/mobile-browser-call.json)。未使用物理麦克风或实测外放回声。
- 原 Sites 网址 v11 已更新，环境 revision 2；真实云端 ASR → Seed → TTS 及匿名访问、跨域、重复请求边界检查通过。

## 国内访问范围

原 `chatgpt.site` 入口的 Globalping 三个中国大陆云探针返回 Cloudflare 403；香港对照也为 403，美国对照为 200。这说明存在入口侧访问限制，不能据此宣称所有国内手机被屏蔽。本机返回 200 的“无代理 curl”解析到了 198.18.x.x，仍受本机网络软件影响，**不作为无梯子证据**。

用户选择复用雅加达服务器，不使用 caizhiyu.com。独立免费域名为 `bread.163-7-7-42.sslip.io`，独立 systemd 服务与 SQLite 元数据存储；上线与探针结果见 [Node 部署说明](../deployment/node/README.md)。服务器与域名可达性不能代替微信内置浏览器麦克风兼容性。

独立免费入口上线后，五个中国大陆探针全部返回 200（深圳、武汉、广州、成都、上海，1.484–3.924 秒）；武汉、上海探针报告联通网络，其他为云网络。新服务器真实 ASR → Seed → TTS 和请求边界检查通过。保留 [探针结果摘要](evaluation/mainland-access.json)、[自托管 API 冒烟](evaluation/jakarta-smoke.json) 和 [Sites API 冒烟](evaluation/sites-mobile-smoke.json)。

## 用户验收后的最终选择：DeepSeek + 同理心提示词

用户确认手机功能可用，但认为 Seed 等待过长，明确要求切回 DeepSeek。最终文字倾听和电话均使用 `deepseek-v4.1-flash-1017`，Anthropic 兼容协议、`thinking.type=disabled`，公开部署继承 Wanjie 分析端点。本机仍经 Magpie；Seed 配置能力保留，生产不再调用 Seed。

提示词版本 `bread-2026-11-01-v18-deepseek-empathy`：先回应已知处境中的具体落差，不责怪、不放大挫折、不编造努力；用户未请求建议时不安排喝水、休息或调整心态。纠正解释后撤回旧判断，不用固定安慰句证明“理解”。窄范围风格校验和一次有界修复继续保留，不增加第二个串行审稿模型。

10 个独立短回复样本全部返回合法 JSON，完整文本响应中位数 **1.372 秒**，范围 **1.117–1.473 秒**。截图原句实际回复：“面试不太顺啊。愿意说说出了什么状况吗？”17 个 Harness 场景（含两个实际三轮历史链）也全部成功。计时仍包含本机网络与网关，不能当作整段电话等待。仍出现“心里肯定不好受”“先不急着给自己下结论”等泛化或建议倾向；改善并非消除所有套话。证据：[DeepSeek 单轮](evaluation/deepseek-empathy-holdout.json)、[多轮 Harness](evaluation/deepseek-harness.json)。

另一次主入口桌面浏览器合成音频测试在 ASR fetch 约 41.7 秒后失败，已保留[失败记录](evaluation/jakarta-browser-call.json)，不算通过；它与先前本机成功、真实 HTTP 冒烟通过、用户手机确认分别记录。页面及 API、AudioWorklet 静态脚本的三个国内探针均为 200，仍不代表所有线路或永久可达。

DeepSeek 发布后，主入口第一次 HTTP 冒烟转写耗时约 32.5 秒、模型返回 502；独立上游探测恢复可用后再次完整检查通过。首轮浏览器 ASR 返回 502，用户麦克风轨道已正确关闭。保留[首轮失败](evaluation/jakarta-deepseek-first-smoke.json)与[成功复检](evaluation/jakarta-deepseek-smoke.json)，不掩盖跨境上游波动。备用 Sites v12 / 环境 revision 3 的[完整链路](evaluation/sites-deepseek-smoke.json)通过。
