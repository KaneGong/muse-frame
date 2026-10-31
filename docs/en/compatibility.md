# Compatibility and preview limitations

- macOS downloadable binary: macOS 26 or later, Apple Silicon arm64; currently ad-hoc signed and not notarized.
- Bundled native libraries require macOS 26.0; the App declares that minimum. Actual release checks were on macOS27.0.1/arm64. Other supported versions and clean devices still need testing. Older systems can try the source WebUI with compatible Python dependencies.
- Intel Mac and Windows binaries: not released or hardware-validated yet.
- Source WebUI: single-user loopback only. No cloud multi-tenant isolation or hosted account/billing service is provided.
- Platforms: Lovart and LibTV. Earlier isolated tests completed one four-image concurrent batch on each, and one Lovart text-guided edit. This is not validation of all models, account tiers, regions, failures or parameter combinations.
- Each model's aspect ratios and size/resolution options come from the platform catalog. If it does not advertise a parameter, the App cannot guarantee that parameter is supported.
- English interface is available. User prompts remain unchanged, and some connection statuses, diagnostics, built-in generation text and upstream gallery content remain Chinese.
- Subject-size percentages are approximate prompt instructions. Models may not follow them precisely. The App cannot promise identity, pose or framing consistency on every generation.
- Third-party gallery availability and download speed depend on the source host. Up to10 selected images import one at a time; failed/remaining selections can be resumed.
- This preview does not include external vision-model prompt reverse engineering, brush/mask editing, in-app billing or bundled generation credits.
- WebKit can report a scaled JPEG decode size as naturalWidth (WebKit bug325301). Local original metadata is used for original-size labels and actual-pixel zoom; previews do not inherit requested original dimensions.
- Some low-height multi-shot layouts keep a large sticky shot summary. Scroll the controls below it when necessary; this remains a layout item for feedback.
