import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class PackagedWorkerTests(unittest.TestCase):
    def test_managed_interpreter_uses_its_own_checkout(self):
        sys.path.insert(0,str(ROOT/'app'))
        from hermes_executor import hermes_workspace
        with tempfile.TemporaryDirectory() as temp:
            env=Path(temp)/'environment';workspace=env/'workspace'
            workspace.mkdir(parents=True)
            (workspace/'hermes_bootstrap.py').touch()
            self.assertEqual(hermes_workspace(env/'venv',Path(temp)),workspace)
            (workspace/'hermes_bootstrap.py').unlink()
            self.assertEqual(hermes_workspace(env/'venv',Path(temp)),Path(temp)/'.hermes/hermes-agent')

    def test_worker_imports_helpers_from_its_bundled_executor_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            resources = Path(temp) / "Contents" / "Resources" / "executor"
            resources.mkdir(parents=True)
            for name in ["hermes_executor.py", "model_options.py", "platform_metadata.py", "pose_observation.py"]:
                shutil.copy2(ROOT / "app" / name, resources / name)

            code = (
                "import pathlib,sys; "
                f"sys.path.insert(0,{str(resources)!r}); "
                "import hermes_executor, platform_metadata, pose_observation; "
                f"assert pathlib.Path(hermes_executor.__file__).parent == pathlib.Path({str(resources)!r}); "
                "assert callable(hermes_executor.generation_arguments); "
                "assert callable(platform_metadata.result_metadata)"
            )
            result = subprocess.run(
                [sys.executable, "-I", "-c", code],
                cwd=temp,
                env={**os.environ, "PYTHONPATH": ""},
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
