# Changelog

## 0.6.1 · 2026-11-23

- Start a product batch after adding its first style and color. Delivery review separates ready files and outstanding shots and identifies partial deliveries.
- Choose local adjustments or AI editing after importing a photo. Local edits create a version you can compare with the original.
- Import a shot plan from JSON or one Markdown JSON block. The English home screen now handles singular image and shot counts.
- The desktop release includes the DSH 0.6.0 planner. The two components have separate version numbers. [Agent installation](docs/agent-plugins.md) · [Mac and Windows downloads](https://github.com/KaneGong/muse-frame/releases/tag/v0.6.1)

## 0.6.0 · 2026-11-23

Stable photography home, Studio workflows, independent agent shot-plan import, and updated Mac and Windows launchers.

## 0.5.0-beta.5

- Added Apple Silicon and Windows x64 launchers for the bilingual, local browser workspace.
- Added workspace inspection, migration, backup and rollback. Provider authorization remains in its own profile.
- Expanded the shooting and reference controls, including gallery filters, favorites and large previews.
- Fixed the packaged reference review for built-in scene originals and the browser loading stale interface files after an update.
- Added a version-switch notice when another copy still owns the workspace.

Mac ad-hoc signed, Windows unsigned. Native Windows validation is pending. See [release notes](RELEASE_NOTES.md).

## 0.4.0-beta.2 — 2026-11-01

- First downloadable preview. Fix startup blocking on reverse DNS; retain the beta.1 candidate tag without publishing its binary release.

First community preview from the standalone19-dev workbench; public license AGPL-3.0-only.

- Local projects, face/body/outfit/environment/pose references and multi-shot planning.
- Lovart/LibTV authorization, platform model options, generation task recovery and text-guided image editing.
- English/Simplified Chinese interface, reference previews and up to10 selected-image imports.
- Photo review, original downloads, floating card actions, local color adjustment and project export.
- Full-resolution main preview; versioned image URLs; WebKit original-dimension and actual-pixel zoom compatibility.
- Separate subject placement/size, environmental long-shot instructions and pose-reference framing boundaries.
- Clean source snapshot, dependency/license notices and public-feedback templates. No historical user data or third-party gallery images.

Mac arm64 only; ad-hoc signed, not notarized. Windows, Intel Mac, hosted multi-user service and built-in billing are not part of this preview. See docs/en/compatibility.md.
