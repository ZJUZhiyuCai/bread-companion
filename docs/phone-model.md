# 电话模型：源码与重建

面包保留照片版毛绒伙伴，只有电话使用真实 3D 几何。运行应用不需要 Blender；仓库已经包含自包含的 `public/companion/3d/bread-phone.glb`。

## 重建

生成器是 `scripts/3d/build_companion.py`。文件名沿用早期试验，但当前只生成电话。已在 Blender **5.2.2 LTS** 上验证：

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/3d/build_companion.py -- \
  --output output/blender \
  --preview front,34,side --preview-size 640
```

输出包括：

- `bread-phone.glb`：网页加载的电话模型。
- `bread-phone.blend`：可编辑场景。
- `preview-front.png`、`preview-34.png`、`preview-side.png`：三个视角的渲染。
- `model-stats.json`：Blender 版本、参数、几何统计和生成耗时。

确认改动后更新网页资产并检查：

```sh
cp output/blender/bread-phone.glb public/companion/3d/bread-phone.glb
npm run check:models
```

`--preview none` 可跳过预览渲染；`--no-blend` 可跳过可编辑文件。`output/` 不进入 Git，仓库保留生成器与网页需要的 GLB。

## 已复现的资产

2026-11-01，Codex 从 DeepSeek 交付的生成器在本机重新生成，GLB 与补丁内资产逐字节一致。使用上面的预览参数，其余参数取默认值；没有启用 `--byte-colors`。

| 项目 | 结果 |
| --- | --- |
| 文件 | 336,668 字节 |
| GLB 几何 | 13,017 三角形、8,129 顶点、8 个网格 |
| 节点 | 14 个 |
| 外部依赖 | 无外部纹理、字体文件或缓冲区 |
| SHA-256 | `d3f1a5c4f07a9815e832651f576e0f36af7b0955bb2736fc3a75e5c710324117` |

这是指定源码和 Blender 版本在本机的复现结果。其他 Blender 版本可能改变导出字节，几何与动画节点仍需检查。

## 网页如何使用它

`components/phone3d/layouts.ts` 定义首页和通话画面的摆放。`engine.ts` 负责材质、灯光、听筒与拨盘；`cord.ts` 在听筒移动时更新卷线。网页材质与照明由运行时处理，因此 Blender 预览与网页截图会有差别。

模型需要保留 `phone`、`phone_body`、`handset`、`handset_body`、`dial_wheel`、`cord_root` 和 `cord_tip` 等节点。检查脚本会拒绝缺少关键节点、外部资源、越界缓冲区或超出预算的导出。

首页先显示 `bread-phone-rest.webp`：从同一模型、运行时相机和灯光导出的透明静帧。它与 Canvas 共用 `HERO_PHONE.overlay`，不先展示轮廓不同的 SVG；服务检查期间保留红色，按钮仍不可拨号。模型首次成功绘制后，两层在同一次界面更新中交接，不叠加淡入淡出。不要将解析成功当成首帧完成。

按钮和 SVG 命中区独立于 Canvas。首页加载、解析或 WebGL 失败时保留同一静帧，通话画面仍用可动画的 SVG；软件渲染器也走静态路径，避免冷着色器编译冻结输入和通话控制。静帧文件本身损坏时才退回 SVG。服务能力未就绪时不初始化 3D；`?phone=svg` 供开发时禁用 WebGL 对照。声音开始前不会让首次 3D 初始化阻塞通话。生命周期和故障注入结果见[功能审查](phone3d-audit.md)。

修改模型、相机、灯光或材质后，需要同时更新静帧；它是实际渲染产物，不是另一套手绘外观。用运行新代码的本机页面和 Playwright CLI 执行 `scripts/3d/capture-phone-poster.js`，导出不含页面纹理、滤镜的透明 PNG，然后以 632×484 像素保存为无损 WebP。截图导出会临时保留测试浏览器的 WebGL 缓冲区，生产渲染器不启用该选项。

```sh
playwright-cli -s=phone-poster open http://127.0.0.1:3210/ --browser chrome --headed
playwright-cli -s=phone-poster run-code --filename scripts/3d/capture-phone-poster.js
node --input-type=module -e "import sharp from 'sharp'; await sharp('output/playwright/bread-phone-rest.png').resize(632,484).webp({lossless:true,effort:6}).toFile('public/companion/3d/bread-phone-rest.webp');"
playwright-cli -s=phone-poster close
```

[本轮加载验收记录](phone-loading-validation.json)保留桌面与手机尺寸下的四阶段边界、颜色和首帧交接检查，以及电话故障回归结果。
