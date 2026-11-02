# 面包 · 本轮前端设计实施说明（给 Codex 审查与渲染回修）

> Claude Opus 5.5，2026-11-02。方案见 `DESIGN-PLAN.md`。
> **没有运行任何测试、typecheck 或浏览器。** 以下所有“效果”都是设计意图，需要 Codex 本机渲染确认。

## 1. 这一轮做了什么（一句话）

把“纸色背景板 + 噪点 + 灯晕 + 一堆材质隐喻”换成**一个有地面、有光向的浅色布景**：暖白的墙向下弯成一块地面，左上方一盏大柔光，右侧一丝冷补光，墙上落着一片淡淡的窗光。毛绒和 Blender 电话都站在这块地面上，用各自的接触阴影。**常规画面里只剩一部电话（Blender 模型 / 它的静帧）**和一个面包（照片毛绒），品牌也改成了照片里的面包本人。

## 2. 素材 / 依赖增量

- **新增文件：无。** 所有改动都在 `EDITABLE.json` 列出的文件内，所以不需要补许可。
- **新依赖、新字体、新位图：无。** 只复用 `bread-plush.webp`、`3d/bread-phone-rest.webp` 和已有的 Bread Voice 子集。
- **首屏请求没有增加**：静帧本来就在 `layout.tsx` 里预加载，品牌头像复用的是首页已经加载的毛绒图。
- 3D 的加载时机、引擎、`phone3d/*`、相位映射一律未改。拨号关键路径上没有新增任何东西。
- **待办（Codex）**：`public/brand/bread-logo.svg` 和 `bread-logo-mono.svg` 里的“面包”目前是 `<text>`，带一串楷体回退。请用 fonttools 从 Bread Voice 子集把这两个字转成路径，静态文件才能在没装字体的环境里保持一致。App 内的字标是实时文字，不受影响。

## 3. 按文件说明

### `app/globals.css`（主要工作量）
- **Tokens**：新增 `--set-*`（墙、地面过渡区、地面、主光、补光、窗光、光池、通话灯）、`--key-face/--key-edge/--key-shadow`（象牙色哑光道具）、`--lacquer*`（挂断用的漆红），浅色和深色各一套。`--ink-3` 加深到 `#645a4f`，确保落在地面上的小字仍 ≥ 4.5:1（估算约 4.7–5.4）。
- **质感关掉**：`--grain`、`--fibre`、`--crayon` 设为 `none`。所有 `background: var(--grain), …` 声明仍然有效，全站噪点和纤维一次清零。`body::before` 的噪点层删除，`body::after` 改成主光加镜头暗角。
- **字体**：`--font-serif` 指向 `--font-sans`，`--font-voice` 的回退链改成楷体优先。`body` 设 `font-synthesis-weight: none`，所有楷体标题改用 400 字重（此前是 600，会被浏览器伪加粗，笔画发糊）。
- **布景**：
  - 首页：`.entry::before` 是墙，`.entry::after` 是窗光。窗光是 2×2 窗格，柔边直接做在 mask 里，因为 mask 在 filter 之后生效，模糊柔化不了它。`.entry__hero::before` 是通栏地面：从脚线上方 74px 开始，过渡区 → 地面 → 更深的近处地面。`.entry` 改为 `overflow: hidden`，让通栏地面不产生滚动。
  - 聊天角落 `.companion`：背景直接画成墙到地面的渐变（px 停靠点对准 192–220px 宽毛绒的脚线），不增加滚动区。
  - 通话：`.session.is-calling` 是同一面墙。`.callroom__main::after` 是地面，放在盒内，不溢出。`.cstage::before` 是两者脚下的一片地面。
  - 结束页：同一布景，主光调暗，窗光更低、更斜、更暖，表示时间过去了，画面并不变黑。
- **面包的位置**：`.nook__glow` 不再是居中在毛绒身后的橙色光盘（这是“抠图外发光”的来源），改为偏左上、范围很大的近白主光。`.nook__table` 改成地面光池。去掉了首页 13 秒循环的 `lamp-warm`（光只跟着真实状态变化）。
- **品牌**：`.brand-mark` 是圆形“联系人照片”，`.brand-type` 用 Bread Voice 排字。`.ai-stamp` 改成一行字“AI · 关于”，44px 命中区，不再用等宽字体，也去掉了分隔线。
- **首页**：标题上方是开场小字 `.entry__eyebrow`。标题不再有蜡笔线和短横线。`hello-bubble` 改成字幕（无框、无尾巴）。`rest-listen` 左侧是一颗象牙色播放键。`first-note` 和聊天 `composer` 统一成同一块哑光书写面（去掉胶条、横线和下面露出的纸）。“以后再做”的链接改成纯文字。
- **电话入口**：首页电话下面是两行展签文字，去掉了搪瓷铭牌、扁平小电话和箭头。`--panel` 是无框的一行：静帧电话加文字，悬停时才出现一层柔光底。`.call-pill` 是象牙色键里站着同一部电话。所有电话的名字都是墨色，**不再用红字**。去掉了首页电话的 `saturate/brightness` 调色。
- **通话**：`.cstage__halo` 三圈细线换成 `.cstage__light`：听你说话时随 `--lvl` 变亮、略微扩大；面包说话时稳定地亮着；思考或转写时 `light-breath` 慢慢呼吸；静音、暂停或出错时调暗；被打断时立刻亮起。它控制在画面宽度以内，`.callroom__main` 加了 `overflow-x: hidden`。字幕改成电影字幕：居中，面包的话用 Bread Voice 1.36rem，你的话更小、更淡。`.cap__who` 视觉上隐藏、DOM 里保留，被打断时改用点状下划线加淡出。键是象牙色哑光圆，挂断是**实心漆红配白色图标**。状态标题降一级，计时去掉胶囊外框。
- **响应式 / 偏好**：900px 以下重新给出布景、窗光和展签的尺寸，并为两行展签留出 14px（特大字为 2.25rem）。forced-colors 下隐藏窗光和通话灯，`ai-stamp` 加边框；不再是框的 `hello-bubble`、`companion__bubble`、`cap--bread` 不再强加边框。减少动态时沿用原规则：`--lvl` 强制为 0，动画瞬时结束，通话灯只剩静态的相位差异，铃声标记常亮。

### `components/RedPhone.tsx`
- 新增 `PHONE_STILL` 和 `PhoneStill`：用静帧替代 `<RedPhone>`，盒子相同（260×220），同一套 `overlayBox(HERO_PHONE)`。SVG 只保留地面阴影和红光（共用 `.has-poster` 规则）。静帧加载失败时（包括水合之前的缓存失败）自动退回完整的 SVG 电话。
- 拨号盘中心盖上的品牌小面包删除，改成素面象牙盖，与 Blender 模型一致。`Brand` 的导入随之去掉。
- `PhoneGlyph` 保留导出，常规画面里不再使用。

### `components/Companion.tsx`
- panel 和 pill 改用 `PhoneStill`。hero 的海报改用 `PHONE_STILL` 常量，结构和 3D 逻辑不变。
- 首页展签去掉 `PhoneGlyph` 和 `ArrowRight`。
- **唯一的文案逻辑改动**：首页展签的第二行现在一直可见。能力检查进行中（pending）时，第二行显示“用说的，不用打字”，不闪出检查文案。真正不可用时显示原因。按下时的提示、`aria-describedby` 和 `title` 都照旧。panel 的行为与之前完全一致。

### `components/CallStage.tsx`
- 三圈 halo 换成 `<span class="cstage__light">`。
- 绘制电话的盒子里加了一张 SVG `<image>` 静帧（与首页海报同一坐标）。听筒在座上的几个 pose（dialing/hold/down/rest）且 3D 未就绪时，显示静帧，SVG 只保留地面阴影、红光和铃声标记。**lifted（贴脸）仍由 SVG 承担**，直到 3D 就绪，因为静帧给不出这个姿态，而姿态必须如实。静帧 `onError` 时全部退回 SVG。相位、`phonePose`、`Phone3D` 的调用都没动。

### `components/CallRoom.tsx`
- 次级操作链接去掉图标（`Pause`、`MessageSquareText`），只改了注释。逻辑、`aria-*`、按键结构和位置都没动。

### `components/EntryScreen.tsx`
- 品牌栏去掉“收到拒信的那个晚上”，移到标题上方作为 `.entry__eyebrow`。标题去掉 `entry__title-mark` 这个 span（文字不变）。去掉 `Headphones`、`ScanText` 和 `Archive` 图标。播放键移到左侧；没有语音时这颗键显示“文”。回调和表单逻辑都没动。

### `components/Brand.tsx`
- `BrandMark` 改为照片头像（复用 `BreadMark`，眼睛与主角一致），`BrandType` 改为 Bread Voice 文字，`BrandLogo` 的结构不变。`BUN` 改成毛绒剪影，`BUN_EYES` 的坐标随之更新。`CURL` 保留导出，值为空串。

### `components/NightWindow.tsx`、`components/EndView.tsx`
- 结束页桌上的电话和“打个电话”按钮都改为 `PhoneStill`。

### `app/layout.tsx`
- `themeColor` 改成布景墙顶的颜色（浅色 `#FBF7F0`，深色 `#211D18`）。

### `public/brand/*.svg`、`public/favicon.svg`
- 毛绒剪影：照片的水滴形、两只脚、正常睁开的眼珠加高光、缝线微笑，光从左上方来。电话卷线退役。favicon 用烤面包皮色的圆角底，在深浅标签栏上都能看清，红色留给电话。

## 4. 测试 / 选择器可能受影响（请先跑一遍）

| 变化 | 说明 |
|---|---|
| `.cstage__halo` 删除 | 换成 `.cstage__light` |
| `.entry__title-mark`、`.wordmark__sub`、`.phone-door__glyph`、`.phone-door__go`、`.rest-listen__icon` 删除 | 纯视觉元素 |
| `.cap__who` 保留 | 视觉隐藏，文字仍在 DOM 里 |
| `.hello-bubble`、`.first-note`、`.rest-listen`、`.phone-door__*`、`.call-pill`、`[data-phone]`、按钮 `aria-label` | 全部保留 |
| `.rest-listen__play` | 现在始终渲染（无语音时内容为“文”） |
| 首页品牌 | `.brand-logo` 里现在是 `<span>`，不再是 `<svg>` |
| `BrandMark` / `BrandType` | 返回的元素类型变了（`span`），导出名不变 |
| 新类名 | `.entry__eyebrow`、`.phone-still`、`.phone-still__img`、`.cstage__still`、`.cstage.has-still`、`.cstage__light`、`.brand-mark__face` |

类型检查需要留意：SVG `<image onError>`（React 支持 `image` 元素的 error 事件，但请 typecheck 确认）；`RedPhone.tsx` 新增了 React hooks 和 `phone3d/layouts` 的导入（`layouts.ts` 没有依赖，不构成循环）。

## 5. 需要视觉验证的点（按优先级）

1. **首页 1440×960 / 1024 / 390 / 320**：地平线（脚线上方 74px 处的过渡区）看起来是“地面”还是“一条色带”。不对的话调 `.entry__hero::before` 的 `top` 偏移和三个停靠点（34/82/560px）。
2. **窗光强度**：应该一眼看不出、细看才发现。如果读成“画了扇窗”，降低 `--set-window` 的 alpha，或加大 mask 的柔边（40%/60% → 36%/64%）。
3. **品牌头像的裁切**：`.brand-mark__face`（125%、-12.5%、-12%）应该框住两只眼睛和微笑，头顶的毛和脚落在圆外。
4. **静帧在小尺寸下的可读性**：胶囊里约 40px，结束页按钮约 2.1em，聊天角落 96px。
5. **通话**：拨号（静帧 + 铃声标记 + 地面红光呼吸）→ 接通（SVG 贴脸，交叉淡化 0.4s）→ 3D。看一次真实拨号；需要确认 3D 的 CALL_PHONE 位置与 SVG/静帧之间的偏移是否明显（这个偏移是原有的，不是本轮引入的）。
6. **`.cstage__light` 的可见度**：浅色墙上 `--set-lamp` 需要能看出“在听”和“在说”的区别，同时不能读成抠图光晕。
7. **字体**：`--font-serif` → 黑体之后，卡片、引用、抽屉和对话框标题的观感。楷体去掉伪粗体后，标题的视觉重量是否足够。
8. **深色模式**：只做了 token 级别的适配，没有逐屏打磨。
9. **对比度**：落在地面上的 `--ink-3` 小字（首页 later 链接、展签第二行），请用 axe 实测。

## 6. 本轮没有做、需要后续素材的

- **听筒贴脸时毛被压下去的效果**，以及毛绒与电话之间的双向反光：需要 Blender 合成或新素材。
- **真实场景底图（plate）**：本轮用 CSS 渐变把“无缝布景”做到能做的程度。真实的影棚布景本来就是平滑渐变，所以这是 CSS 少数能逼真表现的环境，但地面的毛绒接触、景深和遮挡仍然来自现有素材自带的阴影。
- 聊天页里的纸张组件（小票、便签、牛皮纸 chip）结构没动，只是失去了噪点。后续可以把 `--kraft*` 也收进象牙色体系。

---

# 第二轮回修（按 REVIEW.md 与 reference/claude-*.png）

> 同样**没有运行任何测试、typecheck 或浏览器**。只看了 Codex 提供的截图和两张通话帧 PNG。`public/brand/bread-logo*.svg` 未动（保留 Codex 的转曲版本）。没有新增文件和依赖，也没有新的首页预加载。

## A. 通话电话：按相位静帧，不再变脸（必须项）

**`components/CallStage.tsx`（重写电话部分）**
- 接入 `bread-phone-call-rest.webp`（connecting / rest / hold / down）和 `bread-phone-call-lifted.webp`（lifted）。两张都是覆盖整个 1000×820 画幅的 `<img>`（`inset: 0`），坐标与 `CALL_PHONE` 一致，不再嵌在 260×220 的小电话坐标里。首页相机的海报**不再进入通话页**。
- **按需加载**：两张图只在 CallStage 挂载、也就是进入通话时才请求，首页预加载不变。拨号不等待图片或 3D。
- **先解码再接替**：每张图由 `useDecoded` 管理 `loading → ready | failed`。`ready` 的条件是 `load` 之后再 `img.decode()` 成功。它在 effect 里先检查 `img.complete`，所以水合前已经完成的加载，或缓存下来的失败（`naturalWidth === 0`），都能恢复，不依赖 React 的 `onLoad/onError` 时序。`decode()` 不可用或被拒绝但有像素时，按 ready 处理。
- **显示规则**（每次渲染直接算出，不经过 effect 延迟一帧）：
  - 3D 已真实绘制（`solid`）时显示 3D，静帧和 SVG 都隐藏。3D 与静帧在同一次提交里交接（`Phone3D` 的 `onReady` 与 `data-state='ready'` 同帧发布），CSS 里 `.cstage .phone3d`、`.cstage.is-3d .cstage__still` 的过渡都设为 `none`，**没有跨物件的交叉淡化**。
  - 当前 pose 需要的那张已就绪：直接显示。
  - 还在加载：**保持上一张已经显示的帧**（`held` ref），绝不闪出空白或 SVG。首次进入、两张都还没就绪时，电话位置先空着，只有下面 C 节的振铃地面光，之后电话直接出现。
  - 已失败：只有这一 pose 退回 SVG（`.cstage.is-drawn`），而且 3D 一旦就绪就由 3D 接管。另一张成功的静帧照常用于它自己的 pose，**一张失败不会隐藏另一张**。失败的 `<img>` 卸载，另一张的 ref 不受影响。
- **两张静帧之间的切换**：进来的帧立即以不透明度 1 盖在上面，出去的帧在下面用 0.18s 淡出。两帧只有听筒位置不同，所以看上去像旧听筒留下一瞬残影，不会出现空白或第二种电话。这不是跨物件的淡化，也没有伪造听筒运动：真实相位一变，画面就切换。
- SVG 电话在非回退状态下**整个隐藏**（`visibility: hidden`），包括它的地面影子和铃声标记。它们的位置是旧 SVG 坐标，和 `CALL_PHONE` 对不上。回退时 SVG 不再做 0.4s 淡入（`.cstage .rp > * { transition: none }`）。
- `phonePose`、`Phone3D` 的调用、`phone3d/*` 都未改。

**振铃改成地面上的光**（`.cstage__ring` + `@keyframes ring-light`）：只在 `data-phase='connecting'` 时出现，位于 `CALL_PHONE` 底座下方（73% / 93%），是一圈暖红的地面光，节奏是“两下，停一下”的电话铃，不晃动。减少动态时它常亮，作为静态的相位差异。forced-colors 下隐藏。

**失败（down）调色**：3D、静帧和 SVG 统一用 `saturate(0.62) brightness(0.97)`。截图里原来的 `saturate(0.3)` 把漆红压成了泥棕色，看起来像另一部电话。现在三者调色一致，交接时也不会变色。

## B. 按截图做的视觉修整

| 截图中的问题 | 改动 |
|---|---|
| 手机首页：面包的自我介绍在头侧，第二行压到毛和小花上 | ≤900px 时这段话独占 hero 上方一行（`top: -3.1rem`，左对齐），hero 的 `margin-top` 加到 3.3rem。毛绒上移（`--scene-top` 8% → 3%），省出的空间抵消新增的一行。原来为两行展签留的 14px 不再需要。l/xl 字号另有 4.5rem 的规则 |
| 桌面首页：上下大片空白，静物偏小 | hero 上限 560 → `min(610px, 100dvh - 160px)`（矮屏不溢出），列宽比改为 1.08 : 0.92，内容区 1160 → 1200 |
| 地面越往下越深，宽屏上读成一块褐色板 | `--set-floor/--set-floor-far` 改为几乎均匀、只比墙低一档的平面（`#ece2d4` → `#e9dfd0`），`--set-wall-lo` 提亮，让地面和墙仍能分开。新增 `.entry__hero::after` 地面光池（主光照到地面的位置）。小字 `--ink-3` 落在最深的地面上，估算约 5.1:1 |
| 开场小字“收到拒信的那个晚上”字距太大，读成一个个散字 | `letter-spacing` 0.3em → 0.2em |
| “以前留下的”和下面的小字被下划线画了两次，两条链接上下错位 | 拆出 `.later-link__title`，只有它带下划线。两条链接统一用顶部对齐（`align-items: flex-start`，上内边距 11px）。命中区仍是 44px |
| 手机写字框的“进去慢慢写”是一整条通栏，像表单提交按钮 | ≤420px 时按钮靠右、保持自身宽度。超长提示仍占满整行 |
| 桌面聊天角落：毛绒脚下到底部是一整块褐色，和右侧米白对话区之间有明显接缝 | 地面改为毛绒脚下的一片光池（椭圆，中心 340px），在角落的边缘和底部淡回墙色，角落和对话区读起来是同一个房间。电话那一行居中，与毛绒、状态行在同一条轴线上 |
| 失败页的电话是泥棕色 | 见 A |

改动文件：`components/CallStage.tsx`、`components/EntryScreen.tsx`（later 链接的标记结构）、`components/RedPhone.tsx`（只改注释）、`app/globals.css`。

## C. 需要本机验证

1. **真实拨号全程**：connecting（rest 帧加振铃光）→ listening（lifted 帧）→ 3D 首帧。确认没有空白帧、没有 SVG 闪现，也没有首页相机的电话。另外看 3D 首帧与静帧是否逐像素对齐（素材由 Codex 从同一相机导出，理论上一致）。
2. **首次进入通话时 rest 帧未就绪**：电话位置空着的那段时间，在慢网节流下大约有多长。如果太长，可以考虑在首页 idle 后低优先级预取这两张图（不进关键预加载）。本轮没有这样做，因为 REVIEW 要求在进入电话时再请求。
3. **素材失败注入**：分别把 rest / lifted 改成 404。确认只有对应 pose 退回 SVG，另一张照常显示。再用缓存失败在水合前完成的情况验证一次恢复。
4. **rest ↔ lifted 的 0.18s 残影**是否自然。如果读成重影，把 `.cstage__still` 的过渡改为 0 即可（硬切，但仍然无空白）。
5. **振铃地面光**（73%/93%，46%×9%）是否正好落在电话底座下方，节奏是否像电话铃而不是警报。
6. 手机首页：面包的那句话独占一行后，首屏能否仍看到标题、听、写和电话入口（390×844 与 320）。
7. 桌面 1280×720 / 1440×900：hero 变大后的纵向余量，以及新的地面平面（均匀、浅）是否还读得出“地面”。
8. 聊天角落的光池中心（340px）在 236 / 272 / 320 三种角落宽度下是否都落在毛绒脚下与电话之间。
