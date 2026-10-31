# Build and check

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements-build-standalone.txt
npm ci
.venv/bin/python -m unittest discover -s app/tests -p 'test_*.py'
npm test
.venv/bin/python scripts/build_standalone_app.py
```

Build macOS on macOS. The output is `outputs/standalone-app/AI Portrait Studio.app`; the user-facing title is MUSE FRAME. Python and native dependencies are bundled. Keep the bundle ID and data folder stable for existing users. The local build uses an ad-hoc signature and is not notarized.

`requirements-macos.lock` records the tested Python3.14/arm64 build environment; it is not a cross-platform lock. General source installs use requirements.txt. Binary builds and dependency licenses must be checked on each target environment. Windows script is experimental and is not a validated release target yet.

Release packaging uses `scripts/package_release.py`. It exports source from a Git-tracked allowlist, adds the exact source archive and notices beside the App in a DMG, and writes SHA256SUMS. Run it from a clean reviewed checkout; do not add user data or build outputs to Git. Run the release audit before creating an external release.
