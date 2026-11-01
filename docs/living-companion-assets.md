# 毛绒面包与电话素材

2026-10-31。本轮形象以用户提供的 AI 玩具照片作为风格参考，原照片未纳入公开仓库。产品继续叫面包，形象改为原创毛绒小伙伴；动画眼睛与红色座机由 Claude 编写前端，Codex 联调。

## 角色身体

- 文件：[bread-plush.webp](../public/companion/bread-plush.webp)，1254 × 1254，透明 alpha；保留原生尺寸，仅将生成 PNG 编码为 WebP，未手工重画或编辑内容。
- 方式：内置 `image_gen`，不是外部 CLI。眼窝有意不含虹膜与瞳孔，由运行中的组件绘制目光与高光；当前版本保持完整睁眼，不使用眨眼或眼皮遮挡。
- [完整生成提示词](companion-image-prompt.txt)，摘要：

> Production transparent character body for an interactive Chinese emotional companion app named Bread. ONE original, tactile, soft plush companion: a squat gently pear-shaped oatmeal-cream fluffy creature with caramel fur near its base, two tiny rounded feet, a tiny asymmetric tuft and understated stitched smile. Not a loaf or familiar branded toy. Front-facing, symmetrical face, complete body centered with transparent padding. Two large smooth dark espresso-black glass eye wells, no iris or pupil, for the app to overlay animated eyes. Real high-end plush photographed in warm studio light, individually visible fibers, believable rounded volume and self-shadow. Calm and huggable. No scenery, accessories, UI, text, logo or watermark. Genuine alpha transparency. Full subject around 80% of a square canvas; camera straight-on at eye height.

## 柔和表情与配饰

2026-11-01：官方 Claude Code 为原照片体型增加原创毛毡花 SVG、外眼角短睫毛和豆沙色腮红。照片文件未重画，旧椭圆嘴和舌头已移除，开合沿原缝线对齐。源文件与哈希见 [本轮溯源](soft-expression-provenance.json)，设计与验证见 [表情验收](soft-expression-validation.md)。

## 固定开场

- 文件：[hello-warm-bestie.mp3](../public/companion/hello-warm-bestie.mp3)，32 kHz 单声道，3.146 秒，合成音频。
- 原文：“喂，我是面包。我在呢，慢慢说。”
- MiniMax `speech-2.8-hd` / `Chinese (Mandarin)_Warm_Bestie` / speed 1。回转写得到同样的文字（标点不同）。
- 只在服务端配置与此音色、模型、语速匹配时使用本地文件。其他配置正常调用其配置的 TTS；静态文件缺失时最多退回一次正常 TTS。录音和真实对话不进入此缓存。
- 拨号音由浏览器在用户点击后本地合成，麦克风开始监听前停止；拒绝权限、暂停或挂断均清理音频节点。连接和播报状态由实际设备/播放回调驱动，不增加装饰性等待。

## 设计参考

[Moflin](https://www.casio.com/jp/moflin/) 的柔软材质、[Mirumi](https://mirumi.ux-xu.com/) 的短暂注视与转头、[LOVOT](https://lovot.life/en) 的日常细微响应。只借鉴交互思路；产品中不使用它们的品牌形象、照片或健康营销宣称。

素材生成记录不授予第三方模型、音色身份或服务的权利；见 [第三方说明](../THIRD_PARTY_NOTICES.md)。
