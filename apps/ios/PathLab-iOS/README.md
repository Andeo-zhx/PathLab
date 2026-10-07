# PathLab iOS 1.3.2

**当前正式版本：PathLab 1.3.2。** 本目录是 PathLab 跨平台工作根目录中的 iOS 当前源码入口；Windows 与 Android 各有独立工程，历史版本副本和旧构建输出已归档。

PathLab 是病理实验图文标注工作台的独立 iOS 工程，基于桌面版 1.2.3 的项目格式和编辑能力制作。可在 Windows 上修改 Web 代码并生成 iOS 工程；原生编译和真机运行需要 macOS 与 Xcode。

## 本机开发

```bash
npm ci
npm run dev
npm run build
```

第一次生成 iOS 工程：

```bash
npm run ios:add
```

构建 Web 资源并同步到 iOS 工程：

```bash
npm run ios:sync
```

在 Mac 上执行 `npx cap open ios` 打开 `ios/App/App.xcodeproj`，选择 iPhone 或 iPad 模拟器/设备构建。Capacitor 8 的原生 iOS 构建需要 macOS 和 Xcode 26 或更新版本；最低部署版本为 iOS 15。Windows 可以完成 TypeScript/Vite 构建和工程源码编辑，但不能执行 Xcode 编译。

## iOS 操作

- 在“导入图片”或“打开工程”中使用 iOS 文件/照片选择器导入图片和 `.pathlab` 项目。
- 单指使用当前标注工具；“抓手”工具下单指漫游；双指拖动与缩放画布；长按对象打开上下文菜单。
- “保存工程”和 PNG 导出会分块写入应用缓存，然后打开 iOS 分享面板，可选择存储到“文件”或发送到其他应用。
- 文字标注翻译仍由用户点击触发。DeepSeek API Key 存在 iOS 钥匙串；只有提交翻译时才发送当前标注文字。
- 项目草稿使用本应用 WebView 的 IndexedDB；跨设备或从桌面迁入时，请通过 `.pathlab` 文件导入。

## 数据与隐私

`.pathlab` 保持现有 ZIP 格式（`project.json` 与 `assets/*`），无需迁移旧工程。图片、标注和草稿默认保存在设备本地。DeepSeek 请求使用 `deepseek-flash` Chat Completions API，reasoning/thinking 关闭；仅显示响应中的译文内容。

## 当前阶段

本目录是与 Windows 桌面应用隔离的源码副本。仓库已加入手动触发的 GitHub Actions 云构建，可在 macOS runner 上构建未签名 IPA。首次上传和运行方法见 [GitHub Actions iOS 构建说明](GITHUB_ACTIONS_IOS_BUILD.md)。Windows 本机不能运行 Xcode；实际 iOS 编译需要云端 macOS runner。
