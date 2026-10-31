# 快速开始

首次使用建议先看[完整图文教程](user-guide.md)，按参考、镜头、生成、修改与导出的顺序操作。

## Mac下载版

当前仅提供Apple Silicon版本。下载DMG，将App复制到“应用程序”再打开。当前为临时签名、未Apple公证版本，系统拦截说明见README。不要在生成或保存期间替换App。

在“连接与设置”选择Lovart或LibTV，自行完成平台授权。准备人物/身形/服装参考，按需选择环境和姿态，再设置镜头。右侧张数是每个镜头的生成张数。

希望小人物、大环境时，选择“环境远景”与“环境占比大”；左右位置独立选择。旧项目中的旧版占比描述需要重新选择一次才更新，不会自动重写你的原文。

## 本地WebUI源码版

本轮开发验证使用Python3.14与Node.js22。代码至少需要Python3.11，其他解释器版本尚未逐一实测。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app/launcher.py --port 8765 --no-browser
```

浏览器打开http://127.0.0.1:8765；端口被占用时可读取data/instance.json中的实际本地端口。也可直接运行：`.venv/bin/python app/server.py --port 8765 --data ./data`。这是单用户本机服务，请勿直接暴露到公网。

## 数据与更新

Mac App数据保存在`~/Library/Application Support/AI Portrait Studio Standalone`，源码版使用自己的data/目录，两者互相独立。品牌更新沿用既有应用和数据标识，避免丢失旧项目。

先退出App，再备份或替换。完整数据目录含账号授权信息，请在本机安全保存，勿上传GitHub。只删除App不会自动删除项目。

退出App会停止本机后台。已提交的平台任务可能继续，重新打开后按已有任务编号回收；任务状态不确定时不要直接重复提交。
