![MUSE FRAME — Plan your shoot. Shape your frame.](docs/media/portfolio-banner.webp)

# MUSE FRAME · 映象所

**Turn an idea into a series of AI portraits.**

MUSE FRAME is a local-first photography workspace for planning a shoot, arranging references, configuring shots and reviewing results. Create through your own Lovart or LibTV account, with your projects and downloaded images kept on your computer.

**[Download for Mac](https://github.com/KaneGong/muse-frame/releases/tag/v0.4.0-beta.2) · [Full user guide](docs/en/user-guide.md) · [Source WebUI](docs/en/quick-start.md#source-browser-ui) · [简体中文](README.zh-CN.md)**

Community preview **0.4.0-beta.2** · **AGPL-3.0-only** · Mac download: **macOS 26+, Apple Silicon** · Ad-hoc signed, **not Apple-notarized**. Windows and Intel Mac binaries are not available yet.

![Actual Mac App: light workspace with a portrait, image strip and persistent reference panel](docs/media/screenshots/02-workspace-light.webp)

*Actual macOS App, using an isolated demo project and previously generated AI works supplied by the maintainer. The demo is intentionally disconnected; these screenshots do not represent a new generation run.*

## A shoot, from references to a finished set

For AI portrait creators, photographers exploring concepts, and developers who want a local, open-source workflow.

| Step | What you control |
| --- | --- |
| **Prepare** | Create a project; select face, body, outfit, environment and pose references for different roles. |
| **Shape the look** | Choose a photography preset, then fine-tune light, color, contrast and depth of field. |
| **Plan the shots** | Give each shot its own pose, framing, position and subject size. Add shots or apply a template. |
| **Generate** | Review the prompt and reference order in the persistent right panel, then submit through your own provider account. |
| **Select and refine** | Inspect large images, request text-guided edits, adjust color locally and export originals. |

### References with a purpose

Face and body references describe identity and proportions; outfit, environment and pose references have separate jobs. Browse the online libraries, open a large preview, select up to **10 images per import**, then choose which imported reference to use in this shoot. Importing a library image does not automatically apply it.

### Multiple shots, multiple possibilities

Group mode submits the configured shot list. Single mode uses the current shot. The image count means **images per shot**: **3 shots × 4 images = 12 images requested**. Start with one shot and one image to check your setup; provider capabilities and limits still apply.

![Dark theme: four configured shots and the final prompt panel](docs/media/screenshots/03-shots-dark.webp)

### Presets you can adjust

A style preset provides a starting look. Expand Style adjustments to override an individual setting, keep it following the style, or remove that requirement. The right panel lets you check the resulting prompt before submission.

![Light theme: photography style presets and final prompt](docs/media/screenshots/06-style-light.webp)

### Review, edit, keep the original

Select works with checkboxes, download originals or package local images. Open **More actions** for secondary operations. Text-guided editing creates a new task and preserves the original; local color adjustments let you refine an image without submitting another generation task. Ordinary deletion moves works to Trash for recovery.

![Dark theme: works and selection with two selected images](docs/media/screenshots/04-results-dark.webp)

## Selected AI works

Four works from the maintainer's curated collection: street portraits, daylight interiors, minimal spaces and winter styling. These are examples of prior creative work, not guaranteed results or measurements of model consistency.

| Street | Daylight | Editorial | Winter |
| --- | --- | --- | --- |
| ![White knit outfit in a brick alley](docs/media/examples/street.webp) | ![Mustard knit outfit in a sunlit interior](docs/media/examples/daylight.webp) | ![Pink dress in a minimal gallery](docs/media/examples/editorial.webp) | ![Camel winter coat in a gallery](docs/media/examples/winter.webp) |

[View the larger gallery and App screenshots →](docs/showcase.md)

## Your first shoot

1. Download the DMG from [Releases](https://github.com/KaneGong/muse-frame/releases/tag/v0.4.0-beta.2), copy the App to Applications and open it. If macOS blocks it, read [Apple's guidance](https://support.apple.com/en-us/102445); the preview is not notarized.
2. Open **Connect & settings**, choose Lovart or LibTV and complete authorization yourself. Select the models you want to use.
3. Create a project and choose references. Set an environment and a look, then configure one shot.
4. Check the model, supported ratio/resolution, final prompt, reference order and total image count in the right panel. Submit when ready; generation uses your platform credits.
5. Review the result, save the original, and expand the shoot with more shots or a text-guided edit.

**[Illustrated guide: installation → references → shots → generation → editing → export](docs/en/user-guide.md)**

## Choose how to run it

| | Mac App | Source WebUI |
| --- | --- | --- |
| Intended use | Open a desktop workspace | Run locally in a browser; extend the code |
| Requirements | macOS 26+, Apple Silicon arm64 | Python 3.11+ and dependencies; Python 3.14 tested. Node.js 22 used for development checks. |
| Setup | [Download DMG](https://github.com/KaneGong/muse-frame/releases/tag/v0.4.0-beta.2); Python bundled | [Source quick start](docs/en/quick-start.md#source-browser-ui) |
| Availability | Ad-hoc signed, not notarized; other versions/devices need further testing | Single-user localhost service; no hosted multi-user service |

An accessible Lovart or LibTV account and available credits are required for generation. MUSE FRAME has no workbench subscription or bundled generation credits in this preview. It does not train or bundle an image model, and is independent of both providers.

## Privacy and preview limits

Projects and downloaded assets are local. **Submitting work sends the prompt and selected reference images to your provider.** Online galleries contact their source hosts. [Privacy details](docs/en/privacy.md).

Model catalogs, supported parameters, fees and generation policies can change. Connection success does not mean every model combination has been tested. Identity, pose and subject-size instructions are approximate rather than guaranteed geometry. English and Simplified Chinese UI are available; some diagnostics, built-in prompts and upstream gallery text remain Chinese. No brush/mask editor or external vision-model prompt reverse engineering is included. [Compatibility and known limits](docs/en/compatibility.md).

## Help shape the next version

Try a small shoot, tell us what felt confusing, and share reproducible bugs through [Issues](https://github.com/KaneGong/muse-frame/issues/new/choose). Include version, OS/chip, steps and provider/model; remove personal content and credentials from public reports.

[Contributing](CONTRIBUTING.md) · [Build instructions](docs/en/build.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md)

## License and credits

Software: **[AGPL-3.0-only](LICENSE)**, including commercial use under its conditions. Corresponding release source is included alongside the App in the DMG and at each release tag. Preserve the source offer and applicable network-source obligations when redistributing or modifying it.

Showcase images are displayed with the maintainer's authorization; they are not automatically licensed under AGPL. Third-party gallery originals and user projects are not bundled. See [asset provenance](ASSET_LICENSES.md), [dependency notices](THIRD_PARTY_NOTICES.md) and [brand guidelines](TRADEMARKS.md).
