# Visual HTML PPT Editor

本地可运行的 AI HTML PPT 可视化编辑器 MVP。

## 功能

- 一次导入单个或多个 `.html/.htm` 幻灯片文件，自动识别 `section`、`.slide`、`.ppt-slide`、`.html-ppt-slide` 等页面容器。
- 左侧按页显示缩略预览，点击可切换到特定页面继续编辑，支持拖拽排序和上移/下移排序。
- 自动沿用原 HTML 的画布尺寸，例如 `1600x900`，避免非标准尺寸打开后重叠变形。
- 点击元素、拖拽移动、使用八个控制点缩放；按住 `Alt` 拖拽可框选多个元素。
- 右侧面板编辑文字、字号、颜色、填充、加粗、斜体、对齐、层级。
- 支持添加文字框、形状、图片和表格；图片可从文件插入，表格可直接插入或从剪贴板粘贴。
- 左侧支持新增页面和删除页面。
- 支持像 PPT 一样播放当前 deck，可从当前页开始，使用按钮、方向键、空格翻页，`Esc` 退出。
- 支持复制、删除、撤销、重做，以及方向键微调位置。
- 支持保存回原 HTML 文件；在不支持文件写入权限的浏览器里会降级为下载副本。
- 按左侧排序一次导出独立 HTML、PDF 文件、图片版 PPTX、当前页 PNG。
- 本地 `localStorage` 自动保存上一次编辑状态。

## 运行

### Windows 双击运行

1. 先安装 Node.js LTS：`https://nodejs.org/`
2. 双击根目录的 `/Users/weiweizeng/Desktop/html2ppt/start-windows.bat`
3. 浏览器会自动打开 `http://127.0.0.1:5173`
4. 使用时不要关闭弹出的黑色命令行窗口

### macOS 双击运行

第一次先给脚本执行权限：

```bash
chmod +x /Users/weiweizeng/Desktop/html2ppt/start-mac.command
```

之后双击根目录的 `/Users/weiweizeng/Desktop/html2ppt/start-mac.command` 即可。

### 命令行运行

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

## 测试

```bash
npm run build
npm test
npm run test:e2e
```

本次交付已跑通以上三组命令。浏览器冒烟截图保存在：

```text
/Users/weiweizeng/Desktop/html2ppt/visual-html-ppt-editor/artifacts/final-smoke.png
```

并额外验证了 `/Users/weiweizeng/Desktop/htmltoppt` 下 5 个真实 HTML 样本，均按 `1600x900` 正确导入。

端到端测试还覆盖了：

- 只点击选择继承样式文字时，不改变原 HTML 结构和字体格式。
- 一次导入多个 HTML 文件，左侧排序后按新顺序导出一个 deck。
- 从当前页进入播放模式，支持上一页、下一页、键盘翻页和退出。
- 插入图片和表格后导出 HTML 仍保留内容。
- 从剪贴板粘贴图片文件和 TSV 表格时，会插入到当前可编辑页面。
- 左侧新增页面和删除页面。
- 导出合法 `.pdf` 文件。
- `1024x768` 这类非 16:9 HTML 可导出 PDF 和 PPTX。

## 说明

`PDF` 和 `PPTX` 导出当前都采用“先把每页 HTML 渲染成图片，再写入目标文件”的方式，所以非 16:9 文件也能导出。`PPTX` 会按第一页比例创建页面；如果一个 deck 内混用多种比例，后续页面会居中适配。当前 PPTX 的缺点是在 PowerPoint 里不是逐元素可编辑，逐元素可编辑需要下一阶段实现 HTML/CSS 到 PPT shape 的映射。
