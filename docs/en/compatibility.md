# Compatibility and preview limitations

| Surface | Status |
| --- | --- |
| Mac package | Apple Silicon arm64. The DMG includes the minimum macOS target in `BUILD-INFO.txt`. The app is ad-hoc signed and lacks Apple notarization. Intel Mac binaries are unavailable. |
| Windows package | x64 Setup installs for the current user. The installer and launcher are unsigned. [Automated checks on Windows Server 2025 x64](https://github.com/KaneGong/muse-frame/actions/runs/43157259382/job/130979965361) covered installation, launch, image access and migration. Desktop first-launch prompts and the system folder picker remain unverified. |
| Browser workspace | The packaged launchers open the default browser. The server runs on loopback for a single user. Browser layout and gallery behavior can vary. |
| Source WebUI | Use Python 3.14 to match the packaged runtime. See the [source setup](quick-start.md#source-browser-ui). |

- **Language.** English and Simplified Chinese share the same workspace. User-entered text stays as saved. Some provider diagnostics, built-in prompt text and upstream gallery labels remain in their source language.
- **Provider behavior.** Lovart and LibTV require your own account and available credits. Their catalogs determine available models and parameters. Connection, generation review and paid output are distinct operations. Model availability, identity consistency and visual results vary.
- **Local data.** Keep a backup before upgrading. The workbench copies supported workspace data and leaves credentials in their original profile. Provider jobs with uncertain submission status should be checked in task history before submitting again.
- **Galleries.** Catalog availability and download speeds depend on source hosts. Follow the [asset notices](../../ASSET_LICENSES.md) and each source's terms.

[Quick start](quick-start.md) · [Release notes](../../RELEASE_NOTES.md) · [0.4.0-beta.2 Mac release](https://github.com/KaneGong/muse-frame/releases/tag/v0.4.0-beta.2)
