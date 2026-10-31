# Third-party notices

Project-owned software is AGPL-3.0-only. The components below retain their own licenses. Copies of their supplied license/notice texts are in licenses/. Versions reflect the tested macOS build environment; this inventory includes build tools as well as runtime dependencies. Source installs may resolve other versions; re-audit those before redistributing a different build.

| Component | Version | License metadata |
| --- | --- | --- |
| altgraph | 0.17.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.15.1 | MIT |
| attrs | 26.1.0 | MIT |
| bottle | 0.13.4 | MIT |
| certifi | 2026.10.23 | MPL-2.0 |
| cffi | 2.1.1 | MIT-0 |
| click | 8.5.0 | BSD-3-Clause |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| httpx-sse | 0.4.3 | MIT |
| idna | 3.20 | BSD-3-Clause |
| jsonschema | 4.26.0 | MIT |
| jsonschema-specifications | 2025.9.1 | MIT |
| macholib | 1.16.4 | MIT |
| mcp | 1.30.0 | MIT |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pillow | 12.2.0 | MIT-CMU |
| pip | 26.1.1 | MIT |
| proxy_tools | 0.1.0 | MIT |
| pycparser | 3.12 | BSD-3-Clause |
| pydantic | 2.14.2 | MIT |
| pydantic-settings | 2.16.2 | MIT |
| pydantic_core | 2.50.2 | MIT |
| pyinstaller | 6.22.0 | GPLv2-or-later with a special exception which allows to use PyInstaller to build and distribute non-free programs (including commercial ones) |
| pyinstaller-hooks-contrib | 2026.9 | License :: OSI Approved :: Apache Software License; License :: OSI Approved :: GNU General Public License v2 (GPLv2) |
| PyJWT | 2.15.1 | MIT |
| pyobjc-core | 13.0 | MIT |
| pyobjc-framework-Cocoa | 13.0 | MIT |
| pyobjc-framework-Quartz | 13.0 | MIT |
| pyobjc-framework-Security | 13.0 | MIT |
| pyobjc-framework-UniformTypeIdentifiers | 13.0 | MIT |
| pyobjc-framework-WebKit | 13.0 | MIT |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| python-multipart | 0.0.33 | Apache-2.0 |
| pywebview | 6.2.1 | BSD 3-Clause License |
| referencing | 0.37.0 | MIT |
| rpds-py | 2026.9.1 | MIT |
| setuptools | 84.2.1 | MIT |
| sse-starlette | 3.6.0 | BSD-3-Clause |
| starlette | 1.10.0 | BSD-3-Clause |
| typing-inspection | 0.4.4 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| uvicorn | 0.54.0 | BSD-3-Clause |

License metadata discrepancy: proxy_tools 0.1.0 reports MIT in its wheel metadata; its upstream LICENSE.txt contains BSD-2-Clause terms. The upstream notice is reproduced in licenses/proxy_tools/LICENSE; provenance is recorded in licenses/manifest.json.

Native/runtime notices: Python PSF and included component licenses; OpenSSL Apache-2.0; zstd BSD/GPL license alternatives; mpdecimal BSD; SQLite public domain. See corresponding folders in licenses/. Pillow includes its own bundled-library license notices. PyInstaller retains its GPL bootloader exception; using the unmodified bootloader does not relicense the application under GPL-2.0.

UI icons retain app/static/icons/LICENSE (Feather MIT). Reference catalog/source and artwork scope are documented in ASSET_LICENSES.md. No third-party original gallery images are distributed.

以上依赖保留各自许可证，完整声明位于licenses/。清单包含运行与构建工具，不表示全部包都进入最终可执行文件；发布其他构建环境时须重新核对。
