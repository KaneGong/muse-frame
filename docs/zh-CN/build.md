# 构建与检查

使用 Python 3.14 与 Node.js 22。构建安装包请检出对应版本标签。WebUI 构建脚本根据 Git 索引选择素材，并将源码提交号写入安装包。若检查归档源码，请先在刚解压的目录运行 `python3 scripts/audit_release.py`，再安装依赖。

在 Mac 上从源码根目录运行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm test
node --test design/muse-frame-04/tests/*.test.mjs
.venv/bin/python -m unittest discover -s app/tests -p 'test_*.py'
.venv/bin/python -m unittest discover -s design/muse-frame-04/tests -p 'test_*.py'
.venv/bin/python -m unittest discover -s scripts/tests -p 'test_*.py'
.venv/bin/python scripts/audit_release.py
```

## Apple 芯片 DMG

在 Apple 芯片 Mac 上使用原生 arm64 Python，安装记录的构建依赖并运行 WebUI 构建脚本：

```sh
.venv/bin/python -m pip install -r requirements-macos.lock
.venv/bin/python scripts/build_webui_candidate.py macos --output outputs/webui --work work/webui-build
```

构建使用系统工具制作 DMG 和执行临时签名。DMG 内附最低 macOS 版本、应用版本与依赖信息。

## Windows x64 安装程序

安装 Go 后运行：

```sh
.venv/bin/python scripts/build_webui_candidate.py windows --output outputs/webui --work work/webui-build
```

构建支持跨平台编译，会校验锁定的 CPython 和 Pillow 发行包，并生成未签名的安装程序和启动器。安装程序需要在 Windows x64 验证，预发布版验证状态见[兼容性](compatibility.md)。

对应源码归档和校验文件与安装包分别提供。用户资料和构建产物应排除在源码归档之外。
