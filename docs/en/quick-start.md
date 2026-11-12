# Quick start

## Install the local WebUI

1. On an **Apple Silicon Mac**, open the DMG, drag `Muse Frame.app` into Applications and double-click it. The app is ad-hoc signed and lacks Apple notarization. The DMG's `BUILD-INFO.txt` lists the minimum macOS target. [Apple's guidance for opening an app](https://support.apple.com/en-us/102445).
2. On **Windows x64**, open the Setup executable and confirm installation for your Windows user. It launches Muse Frame after setup and adds a Start menu entry. The installer and launcher are unsigned. [Windows x64 automated checks](https://github.com/KaneGong/muse-frame/actions/runs/43157854909/job/130981864740) passed.
3. Muse Frame opens in your default browser. Closing the tab leaves the local service running. Double-click the launcher to reopen it. To stop the service, finish active jobs and use **Your shoots → Workspace migration and backup → Quit Muse Frame**.

Choose the interface language in the upper right. To generate, connect your own Lovart or LibTV account, create a shoot and choose your references. Start with one shot. In the generation review, check the model, parameters, reference images and order, and prompt. Submitting sends that material to your provider and uses your provider credits. [Walk through your first shoot](webui-guide.md).

## Source browser UI

Use Python 3.14 to match the build environment. From the source root on macOS or Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python design/muse-frame-04/beta.py --data ./data --no-browser
```

From PowerShell on Windows with the Python launcher installed:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe design/muse-frame-04/beta.py --data ./data --no-browser
```

Open the loopback URL printed in the terminal, usually `http://127.0.0.1:9014/`. The launcher selects a nearby port when its default is occupied. These commands keep source-run data in the ignored `data/` folder. Keep the service on loopback for single-user use.

## Update, migrate and roll back

**Updating a 0.5.0 WebUI build.** Finish active jobs, save your work and quit the running service before opening the new app. When a different version still holds the workspace open, the new launcher shows both version numbers and links to the running copy. Open that copy's workspace page, quit there once the jobs finish, then launch the version you want.

**Bringing over an older workspace.** Quit the old application and leave its files in place. In **Your shoots → Workspace migration and backup**, choose a detected old workspace or the folder containing its database and images. Choose **Inspect workspace** and review the counts for shoots, assets, results and job history. Resolve missing local files before you choose **Migrate workspace**. Migration creates a separate workspace from supported data, including the saved prompts and locally available images. Historical jobs brought in by migration are not resubmitted automatically.

**Back up or switch workspaces.** Use **Back up to a folder** to save a separate copy of the active workspace. After a migration, **Switch back to the previous workspace** reopens the preceding copy and keeps the workspace you just left. The old app can still open its original data. Keep both versions' data and avoid opening a new workspace in the old app.

The packaged WebUI profile is `~/Library/Application Support/MUSE FRAME` on macOS and `%LOCALAPPDATA%\MUSE FRAME` on Windows. The 0.4.0-beta.2 Mac App used `~/Library/Application Support/AI Portrait Studio Standalone`. The WebUI's workspace copy and backup exclude account credentials. If the WebUI needs authorization, connect the provider yourself. A full manual profile copy may include credentials and should be kept private.

[Compatibility](compatibility.md) · [Privacy](privacy.md) · [0.4.0-beta.2 illustrated guide](user-guide.md)
