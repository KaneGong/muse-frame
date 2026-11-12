![MUSE FRAME · AI portrait photography](docs/media/portfolio-banner.webp)

# MUSE FRAME · 映象所

MUSE FRAME is a local AI portrait workspace for Mac and Windows. Choose a person, outfit, scene and pose, then set the framing and tone for your first photo. Advanced controls let you refine lighting, body reference and shot settings. Projects, saved images and task history stay on your computer. Confirming a task sends its selected references and prompt to your connected Lovart or LibTV account.

**[Download 0.5.0-beta.5](https://github.com/KaneGong/muse-frame/releases/tag/v0.5.0-beta.5) · [First shoot guide](docs/en/webui-guide.md) · [Install and migrate](docs/en/quick-start.md) · [Release notes](RELEASE_NOTES.md) · [简体中文](README.zh-CN.md)**

## Community prerelease 0.5.0-beta.5

The Mac and Windows launchers open the same workspace in your default browser. Both include the components needed to start. The service runs on your computer and listens on loopback.

| Option | Package and validation |
| --- | --- |
| Mac | Apple Silicon DMG. The app is ad-hoc signed and lacks Apple notarization. See the DMG's `BUILD-INFO.txt` for its minimum macOS target. |
| Windows | x64 Setup executable for the current Windows user. The installer and launcher are unsigned. [Windows x64 automated checks](https://github.com/KaneGong/muse-frame/actions/runs/43157259382/job/130979965361) passed. |
| Source | Run the same local WebUI from a source checkout using Python. [Source quick start](docs/en/quick-start.md#source-browser-ui) |

The earlier [0.4.0-beta.2 Mac release](https://github.com/KaneGong/muse-frame/releases/tag/v0.4.0-beta.2) remains available. Its embedded app window and [illustrated guide](docs/en/user-guide.md) belong to that version.

## From references to finished work

- Start a shoot and assign separate roles to the person, outfit, scene and pose references. In advanced controls, add a separate body reference when needed.
- Choose a shooting plan or adjust the framing, subject position, expression, color and light for an individual shot. Browse the person, outfit and pose catalogs and choose which images to use.
- Connect your own provider from Settings. Check the selected model, the prompt and the actual reference images in generation review before submitting.
- Open the resulting photos at full size where available, save originals, make local adjustments or submit a text-guided edit as a new task.

[Walk through your first shoot](docs/en/webui-guide.md) · [Selected work and earlier Mac App screenshots](docs/showcase.md)

## Update and bring a workspace forward

Finish active jobs and quit the running copy from **Your shoots → Workspace migration and backup → Quit Muse Frame** before opening the new version. When an older copy is still running, the new launcher shows both version numbers and a link to the running workspace.

Use **Workspace migration and backup** to inspect an older workspace, copy its supported data into a separate workspace, back up to a folder or switch back to the previous workspace. Keep your old application and data. Connect providers yourself when authorization is needed in the new workspace. [Installation, migration and rollback](docs/en/quick-start.md).

## Privacy, feedback and licensing

Online galleries load from their source hosts. Provider availability, model parameters and fees follow the provider. This prerelease provides English and Simplified Chinese. Some provider diagnostics, built-in prompt text and gallery labels remain in their source language. [Privacy](docs/en/privacy.md) · [Compatibility](docs/en/compatibility.md).

For reproducible issues, include the MUSE FRAME version, operating system, architecture and steps. Remove private images, prompts and credentials from reports. [Issues](https://github.com/KaneGong/muse-frame/issues/new/choose) · [Build](docs/en/build.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md).

Software is [AGPL-3.0-only](LICENSE). The corresponding source archive, file manifest and SHA-256 checksums accompany the 0.5.0-beta.5 binaries as separate files. Showcase artwork and example assets have separate terms. [Asset notices](ASSET_LICENSES.md) · [Dependency notices](THIRD_PARTY_NOTICES.md) · [Brand guidelines](TRADEMARKS.md).
