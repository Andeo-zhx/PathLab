# PathLab

PathLab 1.3.2 is a pathology image annotation workspace for Windows, iPad/iPhone, and Android tablets. It supports image viewing, annotation, observation notes, `.pathlab` project files, and high-resolution image export.

## Projects

- `apps/windows/PathLab-1.3.2` — Electron desktop application.
- `apps/ios/PathLab-iOS` — Capacitor application for iPhone and iPad.
- `apps/android/PathLab-Android-1.3.2` — Capacitor application for Android.

Each platform directory is a standalone project with its own dependency lockfile. See [Building PathLab](docs/BUILDING.md) for setup and build commands.

## Privacy and repository contents

This source snapshot does not include signing certificates, API keys, `.pathlab` user projects, patient images, release binaries, internal task logs, migration manifests, or legacy archives. Do not commit credentials or real patient material. See [Security](docs/SECURITY.md).

The iOS project was imported as a clean source snapshot; earlier private repository history and developer workspace paths are not part of this repository.

## Translation

DeepSeek translation is optional and user-triggered. Users provide their own API key in the application; never add a key to source files, build settings, or issue reports.

## License

PathLab is distributed under the [MIT License](LICENSE).
