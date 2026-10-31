# Quick start

New to the workflow? Follow the [illustrated user guide](user-guide.md) for references, shot planning, generation, editing and export.

## Mac download

The first build targets Apple Silicon. Download the DMG, open it, copy the App to Applications, then launch it. It is ad-hoc signed, not Apple-notarized; see the README and Apple's linked guidance. Do not replace an App while it is generating or saving.

Open Connect & settings, select Lovart or LibTV, and complete authorization yourself. The platform account and credits are yours. Prepare face/body/outfit references and optionally an environment/pose reference, then configure shots. The image count is per shot.

For a small subject in a large environment, choose Environmental long shot and More environment. Position can separately be centered or have side space. For older projects, reselect the legacy subject-size option to update its wording; saved custom text is not silently rewritten.

## Source browser UI

Use Python 3.14 (the tested build version) and Node.js 22 for development checks. Python 3.11+ is required by the code, but older supported interpreters have not been individually validated for this preview.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app/launcher.py --port 8765 --no-browser
```

Then open http://127.0.0.1:8765 (or read data/instance.json for the chosen port if 8765 is busy). Data stays in the source checkout's ignored data/ directory. Never expose this single-user server to the public internet.

Alternatively: `.venv/bin/python app/server.py --port 8765 --data ./data`.

## Data and updates

The packaged Mac App uses `~/Library/Application Support/AI Portrait Studio Standalone`. The source checkout uses its own data/ directory. They are separate. Keep the legacy App/data identity so existing installations retain their projects.

Quit the App before backing up or replacing it. Back up the complete application data folder securely; it contains account authorization. Do not upload it to GitHub. Uninstalling the App alone does not delete projects.

Closing the App stops its local service. A task already submitted to a provider can continue there; reopen to recover its result. Do not resubmit an uncertain task just because it is slow.
