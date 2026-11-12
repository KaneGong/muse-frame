# Build and check

Use Python 3.14 and Node.js 22. To build installers, start from a Git checkout of the matching tag. The WebUI builder uses the Git index to select assets and records the source commit in the package. If you are inspecting a source archive, run `python3 scripts/audit_release.py` in the freshly extracted folder before installing dependencies.

From the source root on macOS:

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

## Apple Silicon DMG

On an Apple Silicon Mac with native arm64 Python, install the recorded build dependencies and run the WebUI builder:

```sh
.venv/bin/python -m pip install -r requirements-macos.lock
.venv/bin/python scripts/build_webui_candidate.py macos --output outputs/webui --work work/webui-build
```

The build uses the system tools for an ad-hoc signature and DMG. The image includes its minimum macOS target, version and dependency information.

## Windows x64 installer

With Go available, run:

```sh
.venv/bin/python scripts/build_webui_candidate.py windows --output outputs/webui --work work/webui-build
```

The builder supports cross-compilation. It verifies the pinned CPython and Pillow distributions and builds an unsigned installer and launcher. Validate the installer on Windows x64. See [compatibility](compatibility.md) for prerelease validation status.

The corresponding source archive and checksums accompany the binaries as separate release files. Keep user data and build output outside the source archive.
