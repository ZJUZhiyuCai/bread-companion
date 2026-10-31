# 电话自然度：心理学依据与本轮设计推断

2026-10-31。用户希望更快接话、直接开口打断、像朋友聊天、减少页面防御性说明。本轮只把研究转为可测试的交互假设，不把面包称为心理治疗产品。

1. Templeton 等（2022），[Fast response times signal social connection in conversation](https://doi.org/10.1073/pnas.2116915119)，PNAS。陌生人和朋友的对话中，较快回应与更强的连接感相关；对录音停顿的实验操纵也影响旁观者对连接感的判断。研究对象是人的交流，不能把其中约 200 毫秒的自然轮替直接当作 AI 的疗效目标。本轮推断：测“本人说完到第一声实际回复”，减少无用串行等待；不靠循环“嗯、我在”掩饰等待，也不为快而抢话。

2. Weger 等（2014），[The Relative Effectiveness of Active Listening in Initial Interactions](https://doi.org/10.1080/10904018.2013.813234)，International Journal of Listening。115 名参与者与受训互动者交流；积极倾听相较建议或简单应答，让参与者更感到被理解。但满意度上，积极倾听与建议没有显著差异，部分效应较小。本轮推断：回复贴住本人刚说的具体内容，记住“不想听建议”的偏好；不是禁止一切建议，也不是每轮换词复述或套用咨询句式。

3. Itzchakov 等（2022 在线发表，2023 卷期），[Connection Heals Wounds](https://pmc.ncbi.nlm.nih.gov/articles/PMC10320710/)，Personality and Social Psychology Bulletin，doi:10.1177/01461672221100369。五项实验共 1,643 人，包含想象与实际交流；讨论被拒绝经历时，高质量倾听影响当下孤独感，关联自主表达和关系感。本轮推断：给本人掌握说话方向与停止的空间；开口能打断、挂断容易、不强制复盘或选择下一项任务。人的交流结果不能直接外推给 AI。

4. Weinstein、Itzchakov、Maniaci，[Exploring the connecting potential of AI](https://guyitzchakov.haifa.ac.il/publications/exploring-the-connecting-potential-of-ai-integrating-human-interpersonal-listening-and-parasocial-support-into-human-computer-interactions)，作者公开原始论文资料。三项实验共 668 人，高质量 AI 倾听与自主/关系需要满足有关，但没有观察到随后孤独感减轻。本轮推断：可以改善被听见的体验，不据此宣称治疗或改善孤独；身份和数据详情放在可主动查看的“关于”里，主界面只留下交流和控制所需文字。

已落实的工程部分：短且自然的电话提示词；按内容回应，不自动说“先歇着、喝水、慢慢来、我在”；语音开启后保持本地输入检测，用户开口中止旧回复并保留新话的开头；用真实服务、可控语音、噪声/回声与迟到结果测试验证。测得的等待和自动打断结果见 [自然电话评估](natural-call-evaluation.md)，不能用这些工程指标代替心理效果证据。
