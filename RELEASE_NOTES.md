# MUSE FRAME 0.5.0-beta.5 · Community prerelease / 社区预发布版

## English

MUSE FRAME now opens the local workspace in your default browser from an Apple Silicon Mac app or a Windows x64 installer. This community prerelease adds workspace migration, backup and rollback alongside the bilingual interface.

### Downloads

| File | Use |
| --- | --- |
| `Muse-Frame-0.5.0-beta.5-macOS-arm64.dmg` | Apple Silicon Mac. Drag the app into Applications. It is ad-hoc signed and lacks Apple notarization. The DMG's `BUILD-INFO.txt` lists the minimum macOS target. |
| `Muse-Frame-0.5.0-beta.5-Windows-x64-Setup.exe` | Windows x64, for the current user. The installer and launcher are unsigned. Open MUSE FRAME from Start after setup. Native Windows validation is pending. |
| `Muse-Frame-0.5.0-beta.5-source.zip`, `SOURCE-MANIFEST.json`, `SHA256SUMS.txt` | Download alongside the packages to inspect the corresponding source and check file integrity. |

The earlier [0.4.0-beta.2 Mac release](https://github.com/KaneGong/muse-frame/releases/tag/v0.4.0-beta.2) remains available.

### Changes since 0.4.0-beta.2

- Plan a shoot in the local browser workspace. Browse, filter and favorite references, preview selected images and use the quick or advanced shooting controls.
- Review the actual prompt and references before submitting. This includes built-in scene images in the packaged app.
- Use English or Simplified Chinese. Your saved text stays as entered. Some provider diagnostics, built-in prompt text and gallery content retain their source language.
- Inspect an old workspace, copy supported shoots, media and job history, back up to a folder or switch back to the previous workspace.
- The browser loads versioned interface files on upgrade. If an older copy is still running, the launcher shows both version numbers and links to the running workspace so you can quit it when its jobs finish.

### Upgrade and validation

Wait for active jobs to finish. In **Your shoots → Workspace migration and backup**, use **Quit Muse Frame** before opening the new version. To bring over older data, close the source app and inspect its workspace before migrating. Keep the old app and its data. Migration and workspace backup exclude provider credentials. Connect your own Lovart or LibTV account when needed. Generation uses your provider credits.

The workspace runs locally in your browser. CrossOver compatibility checks are separate from native Windows validation. This release makes no new claim about live provider authorization, paid generation or output quality.

[Quick start](docs/en/quick-start.md) · [Compatibility](docs/en/compatibility.md) · [Privacy](docs/en/privacy.md) · [Report an issue](https://github.com/KaneGong/muse-frame/issues/new/choose)

## 简体中文

映象所可通过 Apple 芯片 Mac 应用或 Windows x64 安装程序启动，在系统默认浏览器中打开本地工作台。本次社区预发布版提供中英文界面，以及工作区迁移、备份和回退。

### 下载

| 文件 | 用途 |
| --- | --- |
| `Muse-Frame-0.5.0-beta.5-macOS-arm64.dmg` | Apple 芯片 Mac。将 App 拖入“应用程序”。App 采用临时签名，尚未经过 Apple 公证。最低系统版本见 DMG 内的 `BUILD-INFO.txt`。 |
| `Muse-Frame-0.5.0-beta.5-Windows-x64-Setup.exe` | Windows x64，安装到当前用户。安装程序和启动器均未签名。安装后也可从开始菜单打开映象所。待 Windows 实机验证。 |
| `Muse-Frame-0.5.0-beta.5-source.zip`、`SOURCE-MANIFEST.json`、`SHA256SUMS.txt` | 与安装包一同提供，可查阅对应源码并核对文件完整性。 |

此前的 [0.4.0-beta.2 Mac 版](https://github.com/KaneGong/muse-frame/releases/tag/v0.4.0-beta.2) 仍可下载。

### 相比 0.4.0-beta.2 的变化

- 在本地浏览器中规划拍摄。可浏览、筛选和收藏参考图，预览所选图片，并使用快拍或进阶控制。
- 提交前核对实际提示词和参考图，包括安装包中的内置场景原图。
- 提供简体中文和英文界面。已保存的原文保持原样。部分平台诊断、内置提示词和图库内容仍采用来源语言。
- 可检查旧工作区、复制支持的拍摄、图片和任务历史、备份到文件夹，或切回上一份工作区。
- 升级时浏览器会按版本加载界面文件。旧版仍在运行时，新启动器会显示两个版本号并提供打开在用工作区的入口，便于等任务结束后退出。

### 升级与验证

等活动任务结束后，在**拍摄列表 → 工作区迁移与备份**中点**退出本机工作台**，再打开新版。迁移旧资料前，请退出旧程序并检查旧工作区，保留旧程序和原资料。迁移及工作区备份会排除平台凭据。需要时请自行连接 Lovart 或 LibTV，生图使用你的平台额度。

工作台在本机运行，并在浏览器中显示。CrossOver 兼容验证与 Windows 实机验证各自独立。本次发布说明不新增真实平台授权、付费生图或成片质量的验证结论。

[快速开始](docs/zh-CN/quick-start.md) · [兼容性](docs/zh-CN/compatibility.md) · [隐私](docs/zh-CN/privacy.md) · [问题反馈](https://github.com/KaneGong/muse-frame/issues/new/choose)

Software / 软件 [AGPL-3.0-only](LICENSE) · [Asset notices / 素材说明](ASSET_LICENSES.md) · [Dependency notices / 依赖许可](THIRD_PARTY_NOTICES.md)
