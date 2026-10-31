# 面包 · 照片伙伴 + Blender 电话（历史草案）

> Codex 归档说明：以下保留早期 Claude 混合方案原稿，几何参数、材质和初始化时序随后经过 Claude、DeepSeek 与 Codex 的迭代，不能当作当前实现或最终验收记录。当前实现以源码和[电话功能审查](phone3d-audit.md)为准；本段与标题是归档标注，原稿正文未重写。

2026-10-31。依据：`FEEDBACK.md`（用户看完本机实际渲染后的原话：“照片版本的更好，但是电话有进步，你看看电话这个怎么处理”）、`review/preview-first.png`、`review/preview-adapted.png`、`review/model-local.py`（Codex 本机适配）、`docs/assets/bread-rest.png`，以及 `BreadBuddy / RedPhone / CallStage / Companion` 与相关 CSS。

> 本文只描述源码与判断。本轮我没有执行 Blender、Node、渲染或浏览器；下面凡是“效果如何”的地方都是预期，需要 Codex 在 Mac 上跑过才算数。`review/` 里的两张图是**上一版**脚本的实际渲染，不代表本版几何。

## 方向

- **伙伴不动。** 照片毛绒（`bread-plush.webp`）+ `BreadBuddy` 的完整圆眼、稳定注视、眨眼、光照层全部保持原样。3D 伙伴试验到此为止：脚本里的伙伴建模已删除，不再导出 `bread-scene.glb / bread-companion.glb`，也没有 `/3d` 页面、`?scene=3d` 或伙伴 runtime。
- **只有电话是 3D，而且默认就是。** 首页 hero 的电话、通话画面的电话，都是 Blender 模型画在透明 canvas 上，正好叠在原来 SVG 电话的位置。没有设置项、没有实验说明。
- **回退永远在。** 模型没加载完、WebGL 2 不可用、`Save-Data`、文件 404、解析失败、上下文丢失——任何一种情况都继续显示现有 SVG 电话。`?phone=svg` 强制 SVG，方便 Codex 对比。
- **按钮从不依赖 3D。** `<button>`、它的名字、`aria-describedby`、以及 SVG 里那条**静态**命中轮廓 `.rp-hit` 原封不动；canvas `pointer-events:none`、`aria-hidden`，不做 raycast。点击、键盘、读屏在模型加载前、中、后、失败时完全一样。拨号/麦克风流程一行没改，3D 只在页面空闲后才加载，不会推迟 `startCall`。

## 电话这次改了什么（`scripts/3d/build_companion.py`）

用户说“电话有进步”，交付重心是质感和几个关键结构：

| 反馈 | 处理 |
| --- | --- |
| 太亮、像硬塑料 | 漆面 roughness 0.36、薄清漆 coat 0.4 / coat roughness 0.22（原 0.17 / 0.85）；底色加深为 `#b52c26`（`--phone` 是画面里的中间调，不是漆本身）；象牙 0.5 哑光；黄铜 0.36。预览灯换成更大的柔光 key（1.1 m 圆形面光）、整体功率再降；网页端另加程序生成的柔和房间环境反射，让高光是一大片安静的亮，而不是一个硬点。 |
| 拨盘凹槽不清楚 | 新增**拨盘井**：一圈高出面板的漆红斜边，内壁用深色顶点色压暗；象牙盘与红色指轮都低于井沿，所以从任何角度都“嵌在里面”。象牙盘上每个指孔下有一颗深色小点（不伪造数字贴图，但一眼就是号码盘）；指轮的孔是真孔；中心象牙圆顶 + 一圈黄铜环；黄铜指挡跨过指轮外缘。 |
| 听筒两端 | 重做听筒：弯曲手柄 + 两端**向下开口的钟形听筒杯**，杯口是深色凹进的网罩。放在叉簧上时，杯口坐进叉簧顶部的凹窝。 |
| 真实厚度 | 底座加了一道倒角唇边（四层截面）；机身沿用扫掠剖面，两端按超椭圆收圆；叉簧柱、两颗象牙按键（拿起时会弹起）。 |
| 柔软落影 | 网页端：主光投射的软阴影只落在一张“只显示阴影”的透明桌面上，再叠一层底座下的接触暗影；不画任何桌面色块，照片和纸色背景照常透出来。 |

保留并采用 Codex 在 `review/model-local.py` 里实测过的兼容修正：

1. 用顶点色的材质 Base Color 为白色；不用顶点色的材质，常量从 sRGB 转线性后再写。
2. 只有材质实际读取顶点色的网格才写颜色属性（不再给黄铜、线缆写同色 `COLOR_0` 造成二次变暗）。
3. 指轮每个扇区：孔边上的点取“孔心 → 对应外轮廓点”方向，桥接不会自交。
4. 导出 `export_vertex_color="ACTIVE"`、`export_all_vertex_colors=False`，不再出现重复的 `COLOR_1`；颜色属性显式设为 active。
5. 预览 `view_transform = "AgX"`（本机评判用的就是它）。
6. `preferences.filepaths.save_version = 0`（用 `hasattr` 保护）。**没有**采用 `use_save_preview_images`——Blender 5.2 不支持该属性。

`review/model-local.py` 里的伙伴短毛等试验性改动不进入产品，也不进入脚本。

### 生成命令（Mac）

```sh
blender --background --factory-startup \
  --python scripts/3d/build_companion.py -- --output public/companion/3d
```

可选：`--preview 34,side,front`、`--preview-size 768`、`--samples 64`、`--exposure 0.9`、`--byte-colors`、`--no-blend`。只写 `--output` 目录；只用 `bpy / mathutils / 标准库`；无随机数，同参数同结果。

产物：`bread-phone.glb`（网页唯一加载的文件）、`bread-phone.blend`、`preview-34.png`、`preview-side.png`、`model-stats.json`。上一轮留在该目录的 `bread-scene.glb / bread-companion.glb / bread-3d.blend` 已不再被任何代码使用。

### 资产约定

- Blender Z 向上、拨盘朝 -Y；导出 +Y 向上，three.js 里电话站在 y=0、拨盘朝 +Z。单位米，宽 `PHONE_W = 0.125`。
- 节点（子节点都在父节点自身空间里建模，导出后是普通局部变换，没有 parent inverse）：

```
phone ─ phone_body   机身 + 底座 + 拨盘井 + 叉簧柱     m_lacquer（顶点色）
        plungers     两颗按键，原点在台面，沿 +Y 弹起    m_ivory（顶点色）
        dial_plate   号码盘 + 孔下小点                 m_ivory
        dial_wheel   原点在拨盘轴上，绕轴转             m_lacquer
        dial_axis    空节点：dial_wheel → dial_axis 即转轴方向
        dial_cap     中心圆顶                          m_ivory
        dial_stop    指挡 + 圆顶黄铜环                  m_brass（无顶点色）
        cord         静止时的卷线（给 .glb 查看器；网页自己画）  m_cord
        cord_root    空节点：线从机身出来的位置
        handset ─ handset_body                        m_lacquer
                  cord_tip  空节点：线接在话筒杯上
```

缺少可选节点只会少一个动作；缺 `phone_body` 或 `handset` 才视为失败并回到 SVG。

## 前端

新增：

- `components/phone3d/layouts.ts`——两处摆放的唯一数据源（不引 three）：`HERO_PHONE`（RedPhone 的 260×220 空间）、`CALL_PHONE`（CallStage 的 1000×820 空间）。React 用它定位 canvas，引擎用它摆电话，二者不会漂移。
- `components/phone3d/usePhone3D.ts`——SSR 与首帧为 false（水合的是 SVG），挂载后按 `?phone=svg`、WebGL 2、`Save-Data` 决定是否尝试。
- `components/Phone3D.tsx`——每次运行新建一个 canvas；`requestIdleCallback`（1.5 s 超时）后才 `import('./phone3d/engine')` 并取模型；就绪后通知父组件让 SVG 淡出（交叉淡化 0.4 s）。卸载、迟到的解析结果、失败、上下文丢失都会释放全部资源。
- `components/phone3d/engine.ts`——three.js 部分：`GLTFLoader.parseAsync`、换成自己的材质、灯光、阴影、姿态状态机、按需渲染。
- `components/phone3d/cord.ts`——卷线：固定 22 圈的螺旋绕在下垂的三次曲线上，扫成细管；**原地改写同一块缓冲区**，跟随听筒不分配内存。拉长时圈半径收小（圈数不变，与 SVG 卷线同一规则）。

修改：

- `Companion.tsx`：只有 `variant="hero"` 用 3D。RedPhone 外包一层 `.phone-door__art`，Phone3D 叠在上面。悬停/键盘焦点（仅 `:focus-visible`）让听筒在叉簧上抬起一点；离开有 220 ms 缓冲。命中区仍是 SVG 的静态 `.rp-hit`，canvas 不吃指针，所以不存在“抬起 → 移出命中区 → 落下”的抖动环。被阻止（不能打电话）时 canvas 同 SVG 一样去饱和。
- `CallStage.tsx`：Phone3D 覆盖整个 1000×820 画面，`pose = phonePose(call.phase)`。
- `globals.css`：`.phone3d`、`.phone-door__art`，以及 3D 就绪后隐藏 SVG 电话的规则——**保留 `.rp-bell` 铃声线**，响铃时它们照旧出现，减少动态时静止显示，3D 与 2D 用同一种方式说“在响”。

侧栏小电话（`panel`）、手机顶栏的 `pill`、结束页 `LampScene phone` 仍是 SVG：这几处是图标尺寸，或者不在本次范围（首页 + 通话）内。

### 姿态完全来自真实 phase

| `call.phase` → `phonePose` | 3D 电话 |
| --- | --- |
| `connecting` → `dialing` | 指轮按 SVG 同样的节奏拨两下（152°、96°，共 1.9 s，顺时针），之后每 2.2 s 响一次：机身短促摇晃、听筒在叉簧上轻跳。只在这个 phase 动。 |
| `listening/transcribing/thinking/speaking/muted` → `lifted` | 听筒先上再横移、途中转向（0.9 s 弧线），停在照片伙伴右脸旁：话筒端朝下指向嘴、杯口朝伙伴并略朝画面里；线从机身后方一路跟过去并下垂；两颗按键弹起。 |
| `paused` → `hold` | 回到叉簧，略歪。 |
| `error` → `down` | 在叉簧上，canvas 去饱和（与 SVG 同一滤镜）。 |
| 挂断（`idle`）→ `rest` | 原弧线落回。 |

中途换 phase 会从当前位置平滑折返，不会跳。

### 生命周期与性能

- 只有首页和通话会加载 three 与 `bread-phone.glb`；伙伴没有任何 3D 资源。模型字节每页只取一次，首页取过后，通话直接复用；每个画面自己解析、自己释放 GPU 资源。
- **静止就停 RAF**：没有动画在进行时不再出帧；`connecting` 期间或过渡中才连续渲染。离屏（IntersectionObserver）、后台标签页都会停，回来再续。
- DPR 上限 2；`powerPreference: 'low-power'`；阴影贴图 1024；环境反射用 three 自带的 `RoomEnvironment` 现场生成，不下载任何纹理/HDR。
- 减少动态：所有过渡直接到位，不拨号、不摇晃，只渲染一次静态姿态（铃声线由 CSS 静态显示）。
- `webglcontextlost` → 立刻回到 SVG 并释放；卸载时释放几何、材质、纹理、阴影贴图、环境贴图、renderer，并 `forceContextLoss()`。

## 需要 Codex 在 Mac 上核验/调整

1. **跑脚本**并看 `preview-34.png / preview-side.png`：拨盘井是否清楚、听筒杯是否坐进叉簧、漆面是否已经“温润”。偏亮/偏暗先用 `--exposure`，材质在 `build_materials()`。
2. **`npm run typecheck && npm run build`**：重点看 `three/addons/environments/RoomEnvironment.js` 与 `three/addons/loaders/GLTFLoader.js` 的类型解析（@types/three 0.187）。若 `RoomEnvironment` 有问题，可在 `engine.ts` 的 `light()` 里删去环境反射那几行，其余不受影响。
3. **首页对位**：3D 电话应落在原 SVG 电话的位置（命中区就是 SVG 的轮廓）。调 `layouts.ts` 的 `HERO_PHONE.base`（底座中心与视觉宽度）、`yaw/pitch`。用 `?phone=svg` 对比。悬停在电话边缘停住，确认听筒只抬一次、不抖。
4. **通话**：真实走一遍 connecting → listening → paused → 继续 → 挂断。拨盘转向（应顺时针）；若相反，把 `engine.ts` 里 `setFromAxisAngle(rig.axis, -dial)` 的负号去掉。听筒在脸旁的位置/角度调 `CALL_PHONE.cheek`（`x, y, angle`）；线的下垂在 `drawCord()`。
5. **质感**：网页端灯光与材质集中在 `engine.ts` 的 `LOOK` 与 `look()`。目标是和照片同一盏灯：左上暖光、右下阴影。
6. **回退**：DevTools 里用 `WEBGL_lose_context` 触发丢失，确认立即回到 SVG 且按钮可用；把 `public/companion/3d/bread-phone.glb` 改名，确认首页/通话照常（开发环境控制台有一条 `[phone3d]` 警告，生产无输出）。
7. **性能**：Performance 面板里，首页静止时不应有持续的 RAF；通话 `listening` 稳定后同样应停帧。
8. 若 `PCFShadowMap` 的 `radius` 在 0.187 下阴影偏硬，可把 `key.shadow.mapSize` 降到 512 让它更软。

未改：伙伴（`BreadBuddy`、照片、眼睛、注视）、`RedPhone` 本身、通话/麦克风/后端/vm/服务/依赖/package、测试文件。
