# MUSE FRAME 0.4.0-beta.2 · Community preview / 社区预览

This first AGPL-3.0-only preview is for real-world feedback. It includes the current local portrait workflow, multi-shot generation, reference libraries, image review, text-guided edits and color adjustment. There is no workbench subscription or bundled platform credit; generation uses your own provider account.

首次AGPL社区预览，先让大家使用并反馈，稳定迭代后再讨论收费。包含当前本机摄影流程、多镜头、参考图库、选片、文字修改与基础调色。工作台本轮免费，生图使用你自己的平台账号和额度。

Release checks found a startup dependency on reverse DNS. This preview removes it; the beta.1 candidate tag is preserved but its binary release was not published.

发布检查发现本机启动可能卡在反向DNS解析；本版已移除该依赖。beta.1候选标签保留，其安装包未公开发布。

## Download / 下载

- Mac Apple Silicon (macOS 26+): `MuseFrame-0.4.0-beta.2-macos-arm64.dmg`
- Corresponding source: `MuseFrame-0.4.0-beta.2-source.zip` (also inside the DMG)
- SHA256SUMS.txt

Requires macOS 26 or later on Apple Silicon. Older systems can try the source WebUI. The App is ad-hoc signed and NOT Apple-notarized; macOS may block it. Read the installation notes and https://support.apple.com/en-us/102445. Do not disable Gatekeeper globally.

当前安装包要求macOS 26及以上、Apple Silicon芯片；旧系统可尝试源码WebUI。当前为临时签名、未Apple公证版本，可能被系统拦截。请阅读安装说明及Apple官方指引，由你决定是否信任并打开；无需全局关闭系统保护。

## Before generating / 生成前

Authorize Lovart or LibTV yourself. Prompts and chosen reference images are sent to the provider when you submit work, and its fees apply. A model catalog/connection check does not mean every model combination has been tested.

自行授权平台账号，提交任务会发送提示词与所选参考图并使用平台额度。模型目录连接成功不代表所有型号和参数组合均已实测。

Known limits: [English](https://github.com/KaneGong/muse-frame/blob/v0.4.0-beta.2/docs/en/compatibility.md) / [中文](https://github.com/KaneGong/muse-frame/blob/v0.4.0-beta.2/docs/zh-CN/compatibility.md).

Please report reproducible bugs with version, OS/chip, steps and platform/model. Redact personal content. Windows and Intel Mac binaries are not available in this release.

反馈请包含版本、系统/芯片、复现步骤、相关平台和模型，先脱敏。Windows与Intel Mac包尚未发布。
