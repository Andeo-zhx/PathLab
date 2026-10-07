# Building PathLab

The three applications are maintained as standalone projects. Run commands from the relevant project directory.

## Windows / Electron

```powershell
Set-Location apps/windows/PathLab-1.3.2
npm ci
npm run lint
npm run build
```

To start the desktop app locally, run `npm run desktop`. To create a Windows portable build, run `npm run package:portable` on Windows.

## iOS / iPadOS

```bash
cd apps/ios/PathLab-iOS
npm ci
npm run lint
npm run ios:sync
```

Native iOS compilation requires macOS and Xcode. Open `ios/App/App.xcodeproj` in Xcode and select an iPhone or iPad simulator/device. The repository snapshot does not automate IPA packaging.

## Android

```powershell
Set-Location apps/android/PathLab-Android-1.3.2
npm ci
npm run lint
npm run android:build:debug
```

Android Studio and an Android SDK are required. The debug command builds the web application, synchronizes Capacitor, and invokes the Gradle debug build. Release signing credentials are intentionally not included; configure signing locally outside the repository.

## API keys and local configuration

Do not put DeepSeek keys in `.env` files or source code. Enter a key only through the application's settings. Do not commit generated `.pathlab` project files, signing materials, APKs, IPAs, or desktop executables.
