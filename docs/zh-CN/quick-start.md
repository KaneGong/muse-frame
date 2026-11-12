# 快速开始

## 安装本地 WebUI

1. **Apple 芯片 Mac** 打开 DMG，将 `Muse Frame.app` 拖入“应用程序”后双击。App 采用临时签名，尚未经过 Apple 公证。最低 macOS 版本见 DMG 内的 `BUILD-INFO.txt`。[Apple 的应用打开说明](https://support.apple.com/zh-cn/102445)。
2. **Windows x64** 双击 Setup 安装程序，确认安装到当前用户。安装完成后会启动映象所，下次可从开始菜单打开。安装程序和启动器均未签名，[Windows x64 自动检查已通过](https://github.com/KaneGong/muse-frame/actions/runs/43157854909/job/130981864740)。
3. 映象所会打开系统默认浏览器。关闭标签页后，本机服务仍在运行。再次双击启动器可重开页面。需要停止服务时，先等活动任务结束，再从**拍摄列表 → 工作区迁移与备份 → 退出本机工作台**退出。

可在页面右上角切换界面语言。要生图，请自行连接 Lovart 或 LibTV 账号，新建拍摄并选好参考图。先配置一个镜头，在生成确认页核对模型、参数、参考图及顺序和提示词。确认提交后，这些资料会发送至平台，并使用你的平台额度。[第一次拍摄教程](webui-guide.md)。

## 本地 WebUI 源码版

使用与构建环境一致的 Python 3.14。Mac 或 Linux 在源码根目录运行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python design/muse-frame-04/beta.py --data ./data --no-browser
```

Windows 安装 Python 启动器后，在 PowerShell 运行：

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe design/muse-frame-04/beta.py --data ./data --no-browser
```

在浏览器打开终端显示的本地地址，通常为 `http://127.0.0.1:9014/`。默认端口被占用时，启动器会尝试相邻端口。上述命令将资料保存到源码目录下已被 Git 忽略的 `data/`。本服务仅供本机单用户使用。

## 升级、迁移与回退

**升级 0.5.0 WebUI。** 等活动任务结束，保存并退出本机工作台，再打开新版。如果另一版本仍占用工作区，新启动器会显示两个版本号和打开在用工作区的入口。打开在用工作区，等任务结束后在那里退出，再双击要启动的版本。

**接续旧工作区。** 先退出旧程序，保留原有资料。打开**拍摄列表 → 工作区迁移与备份**，选择已找到的旧工作区，或手动选中含数据库和图片的旧资料目录。点**检查内容**，核对拍摄、素材、作品与任务数。若缺失本机文件，先补齐，再点**迁入新版**。迁移会把支持的数据复制到一份独立工作区，其中包括已保存的提示词和可用本机图片。迁入的历史任务不会自动重新提交。

**备份或切回。** 选择**备份到文件夹**可保存当前工作区的独立副本。迁移后选择**回退到上一份工作区**可重新打开前一份，并保留刚离开的工作区。旧程序仍可打开自己的原资料。请保留两份资料，并避免用旧程序写入新版工作区。

Mac 安装版资料位于 `~/Library/Application Support/MUSE FRAME`，Windows 位于 `%LOCALAPPDATA%\MUSE FRAME`。旧版 0.4.0-beta.2 Mac App 使用 `~/Library/Application Support/AI Portrait Studio Standalone`。WebUI 内的迁移与备份会排除账号凭据。需要连接平台时，由你在新版自行授权。手工复制完整资料目录时可能一并复制授权文件，请私密保存。

[兼容性](compatibility.md) · [隐私](privacy.md) · [0.4.0-beta.2 图文教程](user-guide.md)
