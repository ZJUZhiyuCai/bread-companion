# 面包的字体

面包自己的话使用 **Bread Voice**：从 [LXGW WenKai Screen v1.530](https://github.com/lxgw/LxgwWenKai-Screen/releases/tag/v1.530) 自托管的修改版切片。界面、用户输入用系统无衬线；引用与材料用系统宋体。原字体作者 LXGW，许可证为 **SIL Open Font License 1.1**；项目 MIT 许可证不覆盖字体。

## 加载与隐私

- 94 个 WOFF2 切片覆盖原字体的 47,883 个码点。首屏核心切片 **171,200 字节**，包含界面文本与基本拉丁字母；其余按 `unicode-range` 在实际用到字符时下载。所有切片合计 12,372,444 字节，浏览器不会在首屏整包加载。
- 字体与应用同源，不向 Google Fonts、CDN 或上游字体项目发送访问请求。`font-display: swap` 保证字体不可用时仍可阅读。
- 内容哈希文件名便于缓存；核心切片在根布局预加载。动态对话中的罕见汉字按需取片，未收录字符回退系统字体。
- 切片后的内部家族名改为 `Bread Voice`，保留原版权、OFL 与许可证记录，避免修改版冒用原字体名称。

## 重建

使用 Python 3、FontTools 和 Brotli，取得官方发行版 TTF 与 [完整 OFL](../public/design/fonts/OFL-LXGW.txt)，在仓库根目录执行：

```sh
python3 scripts/build-voice-font.py /absolute/path/LXGWWenKaiScreen.ttf /absolute/path/OFL.txt
```

生成文件位于 `public/design/fonts/`。`manifest.json` 记录上游版本、原文件 SHA-256、各片覆盖区间与哈希。脚本并行度为 2，逐片核对覆盖。界面文案改变时核心片哈希可能改变；相应更新 `app/layout.tsx` 的预加载地址。已提交 WOFF2，因此安装和运行项目无需重建，也不需要 Python。

Claude 提出字体与版式；Codex 完成官方下载、切片、许可接入及浏览器验证。Claude 原设计说明保留在 [design-craft-release.md](design-craft-release.md)。
