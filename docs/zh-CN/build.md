# 构建与检查

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements-build-standalone.txt
npm ci
.venv/bin/python -m unittest discover -s app/tests -p 'test_*.py'
npm test
.venv/bin/python scripts/build_standalone_app.py
```

Mac版须在macOS构建。输出`outputs/standalone-app/AI Portrait Studio.app`，界面名称为映象所MUSE FRAME。包内附Python与原生依赖，当前只做临时签名，未公证。

`requirements-macos.lock`记录此次Python3.14/arm64构建环境，不是跨平台锁定文件。一般源码安装用requirements.txt。Windows构建脚本暂为实验性质，不等于已发布Windows版本。

`scripts/package_release.py`按Git跟踪的允许清单导出源码，将对应源码和许可放到App旁的DMG中，并生成SHA256SUMS。须从干净审查后的工作目录执行；不要将用户数据或构建产物加入Git。
