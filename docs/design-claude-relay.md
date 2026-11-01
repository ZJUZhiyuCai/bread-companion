# Claude 本轮交付说明（接 DeepSeek 7416009 / 集成 a1d14d9）

计划见 `DESIGN-PLAN.md`。本轮只改了展示与展示交互，没有动 `services/`、`server/`、`domain/`、`prompts/`、`app/api/`，也没有动麦克风、重试、来源版本、取消、通话状态机。没有新依赖、远程字体、配置项或追踪。

**重要：这里没有 node_modules、Bash 和浏览器。以下改动都没有跑过 typecheck、单测、构建、Playwright、axe，也没有看过实际渲染或做过真实通话。** 下面写的效果都是按代码推断的预期，需要 Codex 本机验证。

## 改了什么

### 1. 连接提示不再盖住内容（观察 1）
文件：`components/Notices.tsx`、`app/globals.css`

- 连接状态从浮动 toast 容器里拆出来，单独放在一个 `role="status" aria-live="polite"` 容器（`.connbar-slot`）里，成为贴在视口顶部的一条全宽信条 `.connbar`。
- 用 `useLayoutEffect` + `ResizeObserver` 量出这条的实际高度，写到 `<html>` 的 `--conn-h` 上；连接恢复或组件卸载时移除。CSS 里：`body { padding-top: var(--conn-h) }`；`.session` 高度改为 `calc(100dvh - var(--conn-h))`；`.entry`、`.end` 最小高度同样扣掉。页面整体往下让出这条的高度，面包的身份气泡、聊天页的面包一行、便笺和发送区都不会被盖住。
- 有信条时顶栏不再重复加刘海安全区；手机会话页和通话页的其他 toast 的 `top` 改为加上 `max(安全区, --conn-h)`。
- 图标从琥珀圆点换成静态的“断开的电话卷线”内联 SVG（`currentColor` 描边）；重连中卷线两侧的小火花隐去。原来圆点在检查时的呼吸动画删掉了，转圈只保留在按钮里。
- 文案、`aria-busy`、“重新连接 / 连接中”、禁用态、`refreshCapabilities` 调用都没变。
- 删掉的类：`.toasts.has-connection`、`.toast__signal`，原 `.toast--connection` 样式也已删除，DOM 里不再有这几个类。**如果 e2e 用到了它们，需要改成 `.connbar` 或按角色/文字查找。**

### 2. 结束页：先看到要决定的事，再看到去处（观察 2）
文件：`components/EndView.tsx`、`app/globals.css`

- 新的顺序：标题 → 一句话 → **取件小票** `.end-desk` → 四个去处 → 说明小字 → 完整卡片（`#end-card`，标题为“整张卡片”）。
- 小票：左侧牛皮纸票根，竖排卡片类型（`CARD_TYPE_LABEL`），打孔线两端各有半月缺口；右侧是 h2（原文案“这张卡片还在桌上”/“这张已经留下了”）、卡片标题（面包字体）、“关掉或刷新页面，它就没有了。”、**留下这张…**（主键，打开原来的 `SavePreview`），以及 **读一遍全文**（按钮：平滑滚到完整卡片并把焦点移过去，减少动态时直接跳，不改 URL）。已保存时票根变成“已留下”的绿色，不再显示保存键。
- 未保存卡片的离开确认原样保留：点任何离开仍出现就地确认，不自动保存、不直接清掉。改动：
  - 确认出现时焦点移到确认说明（`tabIndex=-1`）；点“再想想”后焦点回到刚才按的那个去处按钮（`data-leave`）。从保存弹窗关闭时不抢焦点。
  - “不用了，清掉”从 ghost 改为已有的 `btn--danger`（浅豆沙），后果在视觉上更清楚。
  - 确认框的 `aria-label="确认清掉这张卡片"` 保留，另加 `aria-describedby` 指向说明文字。
  - 外层去处容器加了 `role="group" aria-label="接下来"`。
- 手机端：≤900px 时有卡片的结束插画缩到 `min(168px, 44vw)`，没卡片时 `min(220px, 56vw)`；≤420px 时顶部内边距减小，四个去处两两一行，小票内的按钮撑满。
- 完整卡片里 `CardView` 自带的“留下这张…”还在，所以有卡片时页面上会有两个保存入口，这是有意的。

### 3. 按钮与细节
文件：`app/globals.css`

- 主键：内阴影加上沿一丝受光、下沿一丝压暗，外面一道接触影（哑光釉面）。纸键 `btn--quiet` 和幽灵键 `btn--ghost` 加了 `var(--edge-hi)` 的上沿受光（深色主题自动用暗色版本）；纸键按下时有一道浅内阴影。
- 按钮里的 `ArrowRight`（依赖 lucide 的 `.lucide-arrow-right` 类）在悬停时右移 2px；“读一遍全文”的向下箭头悬停时下移 2px。都是一次过渡，不循环。
- 首页灯光“暖起来”：`.entry::before` 和墙面光晕 `.entry__hero::after` 进入时从 0.45 淡到 1（2.2s / 2.6s），只跑一次。新关键帧 `lamp-on` 不从黑开始。减少动态时由全局规则直接到终点。
- 深色主题：首页标题蜡笔线 `--crayon` 换成更深的琥珀 `#b0743c`、更细、透明度更低，避免浅色字压在亮色带上。
- 输入光标用 `--crust`（铅笔棕）；滚动条用暖色细滑块（根元素设 `scrollbar-color`，会话、通话记录、字幕、弹窗正文和托盘用 `thin`）。
- 强制颜色模式：`.connbar`、`.end-desk`、`.end-confirm` 补了边框；票根缺口隐藏；卷线图标用 `CanvasText`。

### 保持不变
44px 触摸区（新按钮都用现有 `.btn` / `.btn--sm`，粗指针下自动到 44px）、键盘焦点外框、减少动态偏好、3D / 静态 / SVG 降级、电话加载分层、连接原地恢复与草稿、所有组件传参和回调含义。没有新增循环动画，没有自动触发付费调用。

## 需要 Codex 验证 / 未验证范围

1. `npm run typecheck`、`npm test`、`npm run build`、Playwright、axe：全部没跑。
2. 连接信条：390 / 320 宽和大字号下是否换行，`--conn-h` 是否跟着变；首页气泡、聊天页面包一行、通话页顶栏是否完全不被遮挡；恢复后页面是否回到原位、没有残留滚动条；首帧有没有一帧的重叠（用的是 layout effect，预期没有）。
3. e2e 选择器：有没有用到 `.toasts.has-connection` / `.toast--connection` / `.toast__signal`，或者依赖“连接状态和其他 notice 在同一个 status 区域”。
4. 结束页：390×844 首屏能否同时看到小票的保存键和至少第一排去处；确认的焦点移动和“再想想”的焦点归还；读屏对嵌套 group 的朗读；从小票打开保存弹窗、保存后状态切到“已留下”。
5. 票根竖排（`writing-mode: vertical-rl` + `text-orientation: upright`）在 Safari / Firefox 的效果；半月缺口与底色的衔接（缺口用 `--under` = `--bg`，灯光渐变区域可能有轻微色差）。
6. 深色主题：信条、小票、确认框、新蜡笔线的实际对比度。
7. Safari / Firefox、实体手机、真实网络与真实通话：都没有验证。

## 缺少的材料

- 没有修改后的截图；参考截图只有修改前的状态。
- 没有 e2e / 单测源码，无法确认上面删掉的类名有没有被测试引用。
- 本轮没有在 `public/design/frontend-relay/` 新增素材：卷线图标需要 `currentColor` 跟随主题，所以写成了内联 SVG；票根和缺口用 CSS 画。
