# PathLab Android 1.3.2

独立 Capacitor Android 工程。应用显示名为 `PathLab`，应用 ID 为 `org.pathlab.mobile`，版本为 1.3.2 / versionCode 10302。最低 Android 版本为 API 24，目标版本为 API 36。

## Windows 构建

安装 Node.js、Android Studio 和 Android SDK，并设置 `JAVA_HOME`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`。在本目录执行：

```powershell
npm.cmd ci
npm.cmd run android:sync
Set-Location .\android
.\gradlew.bat assembleDebug
```

Gradle 生成的调试包位于 `android/app/build/outputs/apk/debug/app-debug.apk`。迁入的现有 APK 集中在 PathLab 根目录的 `releases/android`；[Android 发布说明](../../../docs/releases/android-1.3.2/PathLab-1.3.2-发布说明.md)列出正式包信息，[模拟器验证记录](../../../docs/releases/android-1.3.2/verification/Android-1.3.2-模拟器验证.md)及其截图、原始测量资料保存在版本记录目录。

Slide 8 `.pathlab` 样例位于 `../../../docs/releases/android-1.3.2/verification/PathLab-Slide8.pathlab`，通过应用的“打开工程”入口加载。

## 签名发布

签名 `.p12` 保存在 PathLab 根目录 `_private/android-signing`，不放进源码工程。当前用户级 `PATHLAB_ANDROID_KEYSTORE` 指向该文件；签名密码仍由 Windows 当前用户的 DPAPI 凭据文件提供。迁移后的签名构建脚本位于 `docs/tasks/2026-10-03-PathLab-Android-signing/build-release.ps1`。不要把密钥或凭据提交到 Git 或与 APK 一起分发。


