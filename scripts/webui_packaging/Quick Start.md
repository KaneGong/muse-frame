# Muse Frame 本地 WebUI / Local WebUI

## 简体中文

- **Mac（Apple Silicon）**　打开 DMG，将 `Muse Frame.app` 拖入「应用程序」，然后双击。可先在 DMG 中双击试用。
- **Windows（x64）**　双击 `Setup.exe` 候选包并确认安装。安装完成后打开浏览器，下次可从开始菜单打开 Muse Frame。安装只用于当前 Windows 用户。
- 启动后工作台在默认浏览器打开。浏览器标签页关闭后，本机服务仍可继续处理任务。再次双击会打开正在运行的工作台。任务结束后，可在「工作区迁移与备份」页面退出本机工作台。
- 如果旧版仍在运行，新版会显示两个版本号及打开在用工作区的入口。等任务结束，在旧版选择「退出本机工作台」，再打开新版。
- 这两个包已包含启动所需依赖。在线图库、平台授权与生图需要联网。绘图平台在设置中由你主动连接。
- 拍摄记录和作品保存在每位系统用户自己的资料目录。Mac 为 `~/Library/Application Support/MUSE FRAME`，Windows 为 `%LOCALAPPDATA%\MUSE FRAME`。使用迁移功能时请先关闭正在使用源工作区的旧程序。保留旧资料及旧版程序，方便回退。
- 这是本地候选版。Mac 使用临时签名，Windows 启动器未经发布者签名。系统可能显示安全提示。技术版本和最低系统版本见 `BUILD-INFO.txt`。素材与依赖许可随包提供。

## English

- **Mac (Apple Silicon)**　Open the DMG, drag `Muse Frame.app` into Applications and double-click it. You can also open it directly from the DMG for a trial.
- **Windows (x64)**　Double-click the `Setup.exe` candidate and confirm installation. The browser opens when setup finishes. Open Muse Frame from the Start menu next time. Setup installs for your Windows user only.
- Muse Frame opens in your default browser. The local service can continue processing jobs after you close the browser tab. Double-click the app again to reopen the running workbench. When your jobs finish, you can quit from **Workspace migration and backup**.
- If an older copy is still running, the new launcher shows both version numbers and links to the running workspace. Wait for its jobs to finish, choose **Quit Muse Frame** there, then reopen the new version.
- The package includes the components needed to start. Online galleries, provider authorization and generation require internet access. Connect your provider in Settings when you're ready.
- Shoots and images are stored in a per-user directory. On Mac, use `~/Library/Application Support/MUSE FRAME`. On Windows, use `%LOCALAPPDATA%\MUSE FRAME`. Close the older app before migrating its workspace. Keep the older app and its files so you can return to them.
- These are local candidates. The Mac app is ad-hoc signed and the Windows launcher is unsigned. Your system may display a security prompt. See `BUILD-INFO.txt` for the version and system details. Asset and dependency notices are included in the package.
