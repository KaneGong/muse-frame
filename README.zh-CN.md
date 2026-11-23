![映象所 MUSE FRAME · AI 人像摄影](docs/media/portfolio-banner.webp)

# 映象所 · MUSE FRAME

映象所是一个适用于 Mac 和 Windows 的本地 AI 人像摄影工作台。选好人物、服装、场景和姿态，配好取景和色调，就能准备第一张照片。需要细调时，可按镜头调整光影、身形参考和拍摄要求。作品、项目和任务记录保存在电脑上，确认提交时才会把所选参考图和提示词发送至你连接的 Lovart、LibTV 或方舟 账号。

**[下载 0.6.1](https://github.com/KaneGong/muse-frame/releases/tag/v0.6.1) · [Agent 插件安装](docs/agent-plugins.md) · [安装与迁移](docs/zh-CN/quick-start.md) · [English](README.md)**

## 摄影工作台 0.6.1

从首页开始拍人像、制作商品套图、上传修图，也可以继续已有拍摄，或预览并导入 Agent 准备的镜头计划。正式版沿用 MUSE FRAME 资料目录与本机 9014 端口。Studio Preview 工作区继续独立保存。每次新建人像拍摄都有自己的参考资料、镜头设置和草稿。

| 下载 | 安装方法 |
| --- | --- |
| Apple 芯片 Mac DMG | 打开 DMG，把 Muse Frame 拖进「应用程序」。采用临时签名，尚未公证。支持 macOS 12 及以上。 |
| Windows x64 Setup.exe | 双击安装，之后从开始菜单启动。安装器未签名。 |
| Agent 插件 | 通过发行页的 TGZ 或项目索引安装 DSH 拍摄计划插件。[安装与导入示例](docs/agent-plugins.md) |

两端都已内置运行环境。系统的下载安全策略可能限制打开。素材和依赖分别保留原有许可。[发布说明](RELEASE_NOTES.md)。

## 从参考图到作品

![摄影工作台首页的人像、商品套图和修图入口](docs/media/studio-06/home.jpg)

- 新建拍摄，为人物、服装、场景和姿态分配各自的参考图。需要单独设置身形时，可在进阶选项中添加。
- 选择拍法，也可以单独调整镜头的取景、人物位置、神态、色调和光线。浏览人物、服装、姿态图库并选择本次要用的图片。
- 从首页打开「绘图平台」，连接自己的平台账号。在生成确认页核对所选模型、实际提示词和参考图，再决定是否提交。
- 打开作品查看可用原图，下载、做本地调色，或通过新任务提交文字修改。

[0.6.1 入门操作](docs/zh-CN/quick-start.md) · [作品选集和旧版 Mac App 截图](docs/showcase.md)

## 升级与接续旧工作区

等任务结束后，从**工作首页 → 工作区迁移与备份 → 退出本机工作台**退出在用版本，再打开新版。如果旧版仍在运行，新版会显示两个版本号，并提供打开在用工作区的入口。

在**工作区迁移与备份**中，可以检查旧工作区、将支持的数据复制到独立工作区、备份到文件夹，或切回上一份工作区。保留旧程序和旧资料。新版需要平台授权时，由你自行连接。[安装、迁移和回退](docs/zh-CN/quick-start.md)。

## 隐私、反馈与许可

在线图库会访问各自的来源站点。平台可用性、模型参数与费用由平台决定。本版提供简体中文与英文界面，部分平台诊断、内置提示词和图库文字仍采用来源语言。[隐私](docs/zh-CN/privacy.md) · [兼容性](docs/zh-CN/compatibility.md)。

反馈可复现问题时，请附 Muse Frame 版本、操作系统、芯片架构及步骤。公开前移除私人图片、提示词和账号凭据。[问题反馈](https://github.com/KaneGong/muse-frame/issues/new/choose) · [构建](docs/zh-CN/build.md) · [更新记录](CHANGELOG.zh-CN.md) · [安全反馈](SECURITY.md)。

软件采用 [AGPL-3.0-only](LICENSE)。0.6.1 对应的源码归档、文件清单和 SHA-256 校验文件与安装包分别提供。展示作品和示例素材适用各自的使用条款。[素材说明](ASSET_LICENSES.md) · [依赖许可](THIRD_PARTY_NOTICES.md) · [品牌说明](TRADEMARKS.md)。
