"""Run all local regression suites and the release source audit."""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    node = shutil.which("node")
    if not node:
        raise SystemExit("Install Node.js and run npm ci before checking Studio.")
    suites = [[sys.executable, "-m", "unittest", "discover", "-s", folder, "-p", "test_*.py"]
              for folder in ("app/tests", "design/muse-frame-04/tests", "scripts/tests")]
    for pattern in ("app/tests/*.cjs", "design/muse-frame-04/tests/*.test.mjs"):
        suites.append([node, "--test", *map(str, sorted(ROOT.glob(pattern)))])
    suites.append([sys.executable, "scripts/audit_release.py"])
    failures = [args for args in suites if subprocess.run(args, cwd=ROOT).returncode]
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
