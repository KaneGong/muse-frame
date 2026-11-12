"""Build the local browser edition for macOS arm64 or Windows x64.

Use an arm64 Python environment with PyInstaller, Pillow and certifi for macOS.
Windows can be cross-built with Go. The packaged interpreter and wheel are pinned.
"""

import argparse
import hashlib
from importlib import metadata
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

from build_standalone_app import bundle_minimum_macos


ROOT = Path(__file__).resolve().parents[1]
DESIGN = Path("design/muse-frame-04")
HELPERS = ROOT / "scripts/webui_packaging"
APP_NAME = "Muse Frame"
BUNDLE_ID = "studio.portrait.museframe.webui"
WINDOWS_PYTHON = "3.14.10"
WINDOWS_DOWNLOADS = (
    (
        f"python-{WINDOWS_PYTHON}-embed-amd64.zip",
        f"https://www.python.org/ftp/python/{WINDOWS_PYTHON}/python-{WINDOWS_PYTHON}-embed-amd64.zip",
        "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159",
    ),
    (
        "pillow-12.2.0-cp314-cp314-win_amd64.whl",
        "https://files.pythonhosted.org/packages/cd/8b/601e6566b957ca50e28725cb6c355c59c2c8609751efbecd980db44e0349/"
        "pillow-12.2.0-cp314-cp314-win_amd64.whl",
        "4e6c62e9d237e9b65fac06857d511e90d8461a32adcc1b9065ea0c0fa3a28150",
    ),
)
LEGAL = ("LICENSE", "COPYRIGHT", "THIRD_PARTY_NOTICES.md", "ASSET_LICENSES.md", "TRADEMARKS.md", "licenses")


def run(*args, **options):
    return subprocess.run(args, cwd=ROOT, check=True, **options)


def checksum(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def pinned_download(directory, filename, url, digest):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / filename
    if not path.is_file():
        with tempfile.TemporaryDirectory(dir=directory) as scratch:
            download = Path(scratch) / filename
            with urllib.request.urlopen(url, timeout=60) as response, download.open("wb") as output:
                shutil.copyfileobj(response, output)
            if checksum(download) != digest:
                raise RuntimeError(f"Download checksum mismatch: {filename}")
            download.replace(path)
    if checksum(path) != digest:
        raise RuntimeError(f"Cached dependency checksum mismatch: {path}")
    return path


def copy_regular(source, target):
    if source.is_symlink() or not source.is_file():
        raise RuntimeError(f"Expected a regular release file: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def stage_web_assets(stage):
    # Large artwork and catalog data must come from the reviewed repository.
    # Developer-local image downloads, tests and the legacy symlink stay outside.
    tracked = run(
        "git", "ls-files", "-z", "--", (DESIGN / "assets").as_posix(), (DESIGN / "data").as_posix(), "app/static",
        capture_output=True,
    ).stdout.decode("utf-8").split("\0")
    for name in filter(None, tracked):
        path = Path(name)
        if {"costume-thumbs", "costume-full"}.intersection(path.parts):
            continue
        copy_regular(ROOT / path, stage / path)
    for source in (ROOT / DESIGN).iterdir():
        if source.suffix in {".html", ".mjs", ".js", ".css"} or source.name in {"identity.json", "ASSETS.md"}:
            copy_regular(source, stage / DESIGN / source.name)
    for name in (DESIGN / "index.html", DESIGN / "data/costumes.json", "app/static/library.json"):
        if not (stage / name).is_file():
            raise RuntimeError(f"Release asset missing: {name}")
    copy_regular(ROOT / "app/standalone-edition", stage / "app/standalone-edition")


def stage_notices(stage):
    legal = stage / "legal"
    for name in LEGAL:
        source = ROOT / name
        if source.is_dir():
            shutil.copytree(source, legal / name)
        else:
            copy_regular(source, legal / name)
    copy_regular(HELPERS / "Quick Start.md", stage / "Quick Start.md")


def build_windows(scratch, cache, artifact, version, commit, go):
    python_zip, pillow_wheel = [pinned_download(cache, *entry) for entry in WINDOWS_DOWNLOADS]
    stage = scratch / APP_NAME
    stage_web_assets(stage)
    stage_notices(stage)
    for directory in (Path("app"), DESIGN):
        for source in (ROOT / directory).glob("*.py"):
            copy_regular(source, stage / directory / source.name)
    copy_regular(ROOT / "app/muse-frame.ico", stage / "app/muse-frame.ico")

    runtime = stage / "runtime"
    with zipfile.ZipFile(python_zip) as archive:
        archive.extractall(runtime)
    with zipfile.ZipFile(pillow_wheel) as archive:
        archive.extractall(runtime / "site-packages")
    (runtime / "python314._pth").write_text(
        "python314.zip\n.\nsite-packages\n../app\n../design/muse-frame-04\n", encoding="ascii",
    )

    go_root = Path(run(go, "env", "GOROOT", capture_output=True, text=True).stdout.strip())
    for name in ("LICENSE", "PATENTS"):
        copy_regular(go_root / name, stage / "legal" / "Go" / name)
    go_version = run(go, "version", capture_output=True, text=True).stdout.split()[2]
    go_env = {**os.environ, "GOOS": "windows", "GOARCH": "amd64", "CGO_ENABLED": "0",
              "GOTOOLCHAIN": "local", "GOWORK": "off", "GOCACHE": str(cache / "go-build")}
    run(
        go, "build", "-trimpath", "-buildvcs=false", "-ldflags=-H=windowsgui -s -w",
        "-o", str(stage / f"{APP_NAME}.exe"), str(HELPERS / "launcher_windows.go"),
        env=go_env,
    )
    (stage / "BUILD-INFO.txt").write_text(
        f"Muse Frame {version}\nSource commit {commit}\nWindows x64, unsigned community preview candidate\n"
        f"CPython {WINDOWS_PYTHON} embeddable, Pillow 12.2.0, launcher compiled with {go_version}\n"
        "CPython and Pillow distribution checksums are pinned in scripts/build_webui_candidate.py.\n",
        encoding="utf-8",
    )
    archive_file = scratch / "payload.zip"
    with zipfile.ZipFile(archive_file, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(stage.rglob("*")):
            if file.is_file():
                archive.write(file, file.relative_to(scratch))
    if artifact.suffix == ".zip":
        shutil.move(archive_file, artifact)
        return
    setup_source = scratch / "setup_windows.go"
    copy_regular(HELPERS / setup_source.name, setup_source)
    setup = scratch / artifact.name
    run(go, "build", "-trimpath", "-buildvcs=false", f"-ldflags=-H=windowsgui -s -w -X main.version={version}",
        "-o", str(setup), str(setup_source), env=go_env)
    shutil.move(setup, artifact)


def build_macos(scratch, artifact, version, commit):
    if (platform.system(), platform.machine()) != ("Darwin", "arm64"):
        raise RuntimeError("The Mac package must be built on Apple Silicon with native arm64 Python.")
    import certifi

    stage = scratch / "resources"
    stage_web_assets(stage)
    stage_notices(stage)
    copy_regular(Path(certifi.where()), stage / "certifi/cacert.pem")
    python_license = Path(sys.base_prefix) / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "LICENSE.txt"
    if python_license.is_file():
        copy_regular(python_license, stage / "legal/licenses/Python/BUILD-LICENSE.txt")
    dist = scratch / "dist"
    command = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--windowed", "--target-architecture", "arm64",
        "--distpath", str(dist), "--workpath", str(scratch / "work"), "--specpath", str(scratch),
        "--name", APP_NAME, "--osx-bundle-identifier", BUNDLE_ID,
        "--icon", str(ROOT / "app/muse-frame.icns"), "--paths", str(ROOT / "app"),
        "--paths", str(ROOT / DESIGN), "--runtime-hook", str(HELPERS / "macos_runtime_hook.py"),
    ]
    for source, destination in (
        (stage / DESIGN, str(DESIGN)), (stage / "app", "app"), (stage / "app/static", "static"),
        (stage / "app/standalone-edition", "."), (stage / "certifi", "certifi"), (stage / "legal", "legal"),
    ):
        command.extend(("--add-data", f"{source}:{destination}"))
    for module in ("tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6", "mcp", "webview"):
        command.extend(("--exclude-module", module))
    run(*command, str(ROOT / DESIGN / "beta.py"))

    app = dist / f"{APP_NAME}.app"
    executable = app / "Contents/MacOS" / APP_NAME
    run("lipo", "-verify_arch", "arm64", str(executable))
    minimum = bundle_minimum_macos(app)
    info_path = app / "Contents/Info.plist"
    info = plistlib.loads(info_path.read_bytes())
    info.update({
        "CFBundleDisplayName": APP_NAME,
        "CFBundleShortVersionString": version.split("-")[0],
        "CFBundleVersion": version.split("-")[0],
        "CFBundleGetInfoString": version,
        "LSMinimumSystemVersion": minimum,
        "LSApplicationCategoryType": "public.app-category.photography",
    })
    info_path.write_bytes(plistlib.dumps(info))
    run("codesign", "--force", "--deep", "--sign", "-", str(app))
    run("codesign", "--verify", "--deep", "--strict", str(app))

    image_root = scratch / "image"
    image_root.mkdir()
    app.rename(image_root / app.name)
    (image_root / "Applications").symlink_to("/Applications", target_is_directory=True)
    copy_regular(stage / "Quick Start.md", image_root / "Quick Start.md")
    (image_root / "BUILD-INFO.txt").write_text(
        f"Muse Frame {version}\nSource commit {commit}\nmacOS arm64, minimum bundle target macOS {minimum}\n"
        f"CPython {platform.python_version()}, Pillow {metadata.version('Pillow')}, "
        f"PyInstaller {metadata.version('PyInstaller')}, certifi {metadata.version('certifi')}\n"
        "Ad-hoc signed local candidate.\n",
        encoding="utf-8",
    )
    image = scratch / artifact.name
    run("hdiutil", "create", "-quiet", "-format", "UDZO", "-volname", f"{APP_NAME} {version}",
        "-srcfolder", str(image_root), str(image))
    run("hdiutil", "verify", "-quiet", str(image))
    shutil.move(image, artifact)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=("macos", "windows"))
    parser.add_argument("--output", required=True, type=Path, help="candidate artifact directory")
    parser.add_argument("--work", required=True, type=Path, help="temporary build and dependency cache directory")
    parser.add_argument("--go", default="go", help="Go executable used for the Windows launcher")
    parser.add_argument("--windows-portable", action="store_true", help="build the Windows recovery ZIP instead of Setup.exe")
    args = parser.parse_args()
    version = (ROOT / "VERSION").read_text(encoding="ascii").strip()
    commit = run("git", "rev-parse", "HEAD", capture_output=True, text=True).stdout.strip()
    args.output.mkdir(parents=True, exist_ok=True)
    args.work.mkdir(parents=True, exist_ok=True)
    if args.target == "macos":
        platform_name = "macOS-arm64.dmg"
    else:
        platform_name = "Windows-x64.zip" if args.windows_portable else "Windows-x64-Setup.exe"
    artifact = args.output.resolve() / f"Muse-Frame-{version}-{platform_name}"
    if artifact.exists():
        raise SystemExit(f"Candidate already exists: {artifact}")
    with tempfile.TemporaryDirectory(prefix=f"muse-{args.target}-", dir=args.work.resolve()) as directory:
        scratch = Path(directory)
        if args.target == "macos":
            build_macos(scratch, artifact, version, commit)
        else:
            build_windows(scratch, args.work.resolve() / "downloads", artifact, version, commit, args.go)
    print(f"{checksum(artifact)}  {artifact}")


if __name__ == "__main__":
    main()
