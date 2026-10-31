# 映象所 · MUSE FRAME

在本机管理 AI 人像摄影流程：准备参考、设计镜头，并连接你自己的绘图平台生成作品。

**[English](README.md) · [下载 Mac 版](https://github.com/KaneGong/muse-frame/releases/tag/v0.4.0-beta.1) · [快速开始](docs/zh-CN/quick-start.md) · [反馈问题](https://github.com/KaneGong/muse-frame/issues/new/choose)**

社区预览版 **0.4.0-beta.1**，采用 **AGPL-3.0-only**。本轮先收集真实使用反馈，持续改进稳定性与体验。

当前下载包适用于 **macOS 26及以上的Apple Silicon / arm64 Mac**，使用临时签名，尚未经过 Apple 公证。Windows 和 Intel Mac 安装包留待后续实测发布。

## 能做什么

- 按项目管理人物、身形、服装、环境与姿态参考。
- 设计多个镜头，分别设置姿态、景别、画面位置和人物占比。
- 连接自己的 Lovart 或 LibTV 账号，使用平台当前提供的模型。
- 每个镜头生成1–4张；“多个镜头”与“同镜头多张”是不同设置。
- 查看作品、用文字发起修改、本机基础调色和下载原图。
- 在线图库先看大图、再选择，每次最多10张导入；导入后由用户选择拍摄参考。
- 中英文界面；用户原文不自动翻译，部分连接状态、诊断、内置提示词与上游图库名称仍为中文。

这是独立工作台，不是绘图模型，也不是 Lovart/LibTV 官方产品。出图效果、平台额度、审核和模型可用性由对应平台决定。

## 三步开始

1. 从 [Releases](https://github.com/KaneGong/muse-frame/releases/tag/v0.4.0-beta.1) 下载 Mac DMG，阅读安装说明，将 App 复制到“应用程序”。
2. 打开“连接与设置”，自行授权绘图平台账号。全新安装不会复制其他软件登录，也不会自动提交收费生成。
3. 新建项目、选择参考并设置镜头，准备好后点击生成；平台会按账号规则消耗额度。

浏览器界面可按[源码启动说明](docs/zh-CN/quick-start.md)在本机运行。当前不是公网多用户服务。

## 数据与使用边界

项目和已下载图片在本机保存。**提交生图或修改时，提示词及所选参考图会发送给对应平台。** 在线图库会访问作者源站，详见[隐私说明](docs/zh-CN/privacy.md)。

App 已附带 Python。生成需要平台账号、额度和网络。模型目录连接成功不等于所有型号和参数均已实测；人物占比是近似提示词目标，见[兼容与已知限制](docs/zh-CN/compatibility.md)。

未公证版本可能被 macOS 拦截；阅读 [Apple 官方说明](https://support.apple.com/zh-cn/102445)，由你决定是否信任并打开。无需全局关闭系统保护。

## 反馈和参与

缺陷请到 [Issues](https://github.com/KaneGong/muse-frame/issues/new/choose)；使用交流和建议可在启用后的 [Discussions](https://github.com/KaneGong/muse-frame/discussions) 提交。公开反馈请勿附带登录信息、私人照片或完整用户数据库。

[贡献说明](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [更新记录](CHANGELOG.zh-CN.md) · [构建说明](docs/zh-CN/build.md)

## 许可

项目软件采用 [AGPL-3.0-only](LICENSE)，允许按协议条件商用。第三方依赖、参考图片与品牌分别见 [依赖声明](THIRD_PARTY_NOTICES.md)、[素材说明](ASSET_LICENSES.md)、[品牌说明](TRADEMARKS.md)。

对应源码按版本标签提供，并随 DMG 一同分发。再分发、修改或通过网络提供修改版时，请遵守对应源码义务。公开包不包含用户项目或第三方图库原图。
