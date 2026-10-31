![MUSE FRAME portfolio](https://raw.githubusercontent.com/KaneGong/muse-frame/main/docs/media/portfolio-banner.webp)

# MUSE FRAME · 映象所 — 0.4.0-beta.2

**Plan your shoot. Shape your frame. · 把灵感，拍成一组作品。**

A local-first AI portrait workspace: arrange references, design a look, plan shots, generate through your own platform, then select, edit and export.

从参考、影调和镜头规划，到生图、选片、文字修改与导出，把一次 AI 人像创作组织成完整的拍摄流程。

**[Product introduction / 产品介绍](https://github.com/KaneGong/muse-frame#readme) · [中文首页](https://github.com/KaneGong/muse-frame/blob/main/README.zh-CN.md) · [English guide](https://github.com/KaneGong/muse-frame/blob/main/docs/en/user-guide.md) · [中文图文教程](https://github.com/KaneGong/muse-frame/blob/main/docs/zh-CN/user-guide.md)**

## Inside the workspace / 工作台一览

![Actual Mac App, light shoot workspace](https://raw.githubusercontent.com/KaneGong/muse-frame/main/docs/media/screenshots/02-workspace-light.webp)

- Separate face, body, outfit, environment and pose references; large online-library previews and up to 10 selected imports.
- Photography presets with individual adjustments; multiple configured shots; 1–4 requested images per shot.
- Persistent prompt/reference inspector, large previews, text-guided edits retaining the original, local color and original-image export.

- 分别管理面部、身形、服装、环境和姿态参考；在线图库先看大图，单次最多复选导入 10 张。
- 摄影风格可单独微调；镜头逐个配置，每镜头请求 1–4 张，3 个镜头 × 4 张 = 共请求 12 张。
- 右侧常驻核对提示词和参考，放大选片，文字修改保留原版，本地调色并导出原图。

![Actual Mac App, dark works and selection](https://raw.githubusercontent.com/KaneGong/muse-frame/main/docs/media/screenshots/04-results-dark.webp)

Screenshots show the actual App with an isolated demo project and maintainer-authorized, previously generated AI works. Disconnected status is intentional; no new generation run is claimed. [Larger works and all six screenshots](https://github.com/KaneGong/muse-frame/blob/main/docs/showcase.md).

截图来自真实 App，使用独立演示项目和维护者授权的既有 AI 作品；未连接状态有意保留，不代表新增生图。横幅为基于作品和 Logo 的 AI 辅助排版。单幅作品和更多界面见上方影集链接。

## Download / 下载

In the Assets list below / 页面底部 Assets 中：

- **Mac App:** `MuseFrame-0.4.0-beta.2-macos-arm64.dmg`
- **Corresponding source / 对应源码:** `MuseFrame-0.4.0-beta.2-source.zip` — also included inside the DMG / DMG 内也有
- **Checksums / 校验文件:** `SHA256SUMS.txt`
- **Source inventory / 源码清单:** `SOURCE-MANIFEST.json`

**Requires macOS 26+, Apple Silicon arm64. Ad-hoc signed, not Apple-notarized.** Release checks ran on macOS 27.0.1 / arm64; other versions/devices need more testing. Windows and Intel Mac binaries are not available yet. Copy the App to Applications. If macOS blocks it, read [Apple's guidance](https://support.apple.com/en-us/102445); do not disable Gatekeeper globally. Older systems can try the [source WebUI](https://github.com/KaneGong/muse-frame/blob/main/docs/en/quick-start.md#source-browser-ui).

**当前安装包要求 macOS 26+、Apple Silicon，临时签名、未 Apple 公证。** 本轮实测环境为 macOS 27.0.1 / arm64，其他系统与设备仍需继续验证；Windows、Intel Mac 包尚未提供。打开 DMG 后将 App 复制到“应用程序”；若受系统拦截请参考 [Apple 官方说明](https://support.apple.com/zh-cn/102445)，无需全局关闭系统保护。旧系统可尝试[源码 WebUI](https://github.com/KaneGong/muse-frame/blob/main/docs/zh-CN/quick-start.md#本地webui源码版)。

## First shoot / 第一次使用

1. Open settings, choose Lovart or LibTV and authorize your own account.
2. Create a project, choose references and configure one shot.
3. Review the model's supported ratio/resolution, final prompt, reference order and total count.
4. Submit when ready, then inspect the task and save the original.

1. 在设置中选择 Lovart 或 LibTV，并完成自己的账号授权。
2. 新建项目，选择参考，先配置一个镜头。
3. 核对型号支持的画幅/分辨率、提示词、参考顺序和总张数。
4. 确认后生成，在任务页查看结果并保存原图。

Generation sends prompts and selected references to the provider and uses **your platform credits**. This preview has no workbench subscription or bundled generation credits. Model availability, fees and output quality depend on the provider. Connection checks do not validate every model combination. English UI is available; some diagnostics, built-in prompts and upstream labels remain Chinese.

生成会发送提示词和选中参考图至绘图平台，使用**你自己的平台额度**。本轮工作台免费，不赠送生图额度；型号、费用与结果由平台决定，连接成功不代表全部组合实测。支持英文界面，部分诊断、内置提示词和上游标签仍为中文。

## Preview notes / 预览说明

beta.2 removes a reverse-DNS dependency that could block local startup. The beta.1 candidate tag is retained, but its binary release was not published. This is a community preview for feedback.

beta.2 修复了可能阻碍本机启动的反向 DNS 依赖。beta.1 候选标签保留，其安装包未公开发布。欢迎先试用并反馈。

[Known limits / 兼容性](https://github.com/KaneGong/muse-frame/blob/main/docs/en/compatibility.md) · [中文限制说明](https://github.com/KaneGong/muse-frame/blob/main/docs/zh-CN/compatibility.md) · [Privacy / 隐私](https://github.com/KaneGong/muse-frame/blob/main/docs/en/privacy.md) · [Issues / 反馈](https://github.com/KaneGong/muse-frame/issues/new/choose)

Software is **AGPL-3.0-only**. Showcase artwork has separate [asset notices](https://github.com/KaneGong/muse-frame/blob/main/ASSET_LICENSES.md), not an automatic AGPL image license. Please remove credentials and personal content from public bug reports.

软件采用 **AGPL-3.0-only**；展示作品遵循独立素材说明，不自动纳入 AGPL。公开反馈前请移除凭据和私人内容。
