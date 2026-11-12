"""Prepare the source and checksums that accompany both WebUI installers."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import stat
import zipfile

from audit_release import audit
from build_webui_candidate import ROOT, checksum, run


def source_manifest(archive, prefix, version, commit):
    files = []
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            if entry.is_dir():
                continue
            item = {"path": entry.filename.removeprefix(prefix),
                    "sha256": hashlib.sha256(bundle.read(entry)).hexdigest()}
            if stat.S_ISLNK(entry.external_attr >> 16):
                item["type"] = "symlink"
            files.append(item)
    return {"version": version, "source_commit": commit, "files": files}


def prepare(output):
    if run("git", "status", "--porcelain", capture_output=True).stdout:
        raise SystemExit("Prepare from the clean, frozen source checkout.")
    if audit()["problems"]:
        raise SystemExit("Source audit failed.")
    version = (ROOT / "VERSION").read_text(encoding="ascii").strip()
    commit = run("git", "rev-parse", "HEAD", capture_output=True, text=True).stdout.strip()
    names = [f"Muse-Frame-{version}-{suffix}" for suffix in ("macOS-arm64.dmg", "Windows-x64-Setup.exe")]
    if any(not (output / name).is_file() for name in names):
        raise SystemExit("Both candidate installers must be present.")
    prefix = f"muse-frame-{version}/"
    archive = output / f"Muse-Frame-{version}-source.zip"
    run("git", "archive", "--format=zip", f"--prefix={prefix}", f"--output={archive}", commit)
    manifest = output / "SOURCE-MANIFEST.json"
    manifest.write_text(json.dumps(source_manifest(archive, prefix, version, commit), ensure_ascii=False, indent=2)
                        + "\n", encoding="utf-8")
    notes = output / "RELEASE_NOTES.md"
    shutil.copyfile(ROOT / notes.name, notes)
    checked = [*names, archive.name, manifest.name, notes.name]
    (output / "SHA256SUMS.txt").write_text(
        "".join(f"{checksum(output / name)}  {name}\n" for name in checked), encoding="ascii")
    print(f"Muse Frame {version} · {commit} · {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    prepare(parser.parse_args().output.resolve())
