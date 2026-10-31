import importlib.util,os,tempfile,unittest,shutil
from pathlib import Path
from unittest.mock import patch
class EditionTests(unittest.TestCase):
 def load(self,root):
  spec=importlib.util.spec_from_file_location('edition_test_runtime',root/'runtime.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
 def test_private_install_keeps_legacy_data_and_port_without_using_open_data(self):
  with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{},clear=True):
   root=Path(d)/'portrait-workbench-v2';root.mkdir();shutil.copy2(Path(__file__).parents[1]/'runtime.py',root/'runtime.py');(root/'private-edition').touch()
   runtime=self.load(root);self.assertEqual(runtime.EDITION_NAME,'私有版');self.assertEqual(runtime.DEFAULT_PORT,8766);self.assertEqual(runtime.data_dir(),(Path(d)/'portrait-workbench-v1/data').resolve())
 def test_open_install_keeps_independent_data_and_explicit_test_override(self):
  with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{},clear=True):
   root=Path(d);shutil.copy2(Path(__file__).parents[1]/'runtime.py',root/'runtime.py');runtime=self.load(root)
   self.assertEqual(runtime.EDITION_NAME,'开放版');self.assertEqual(runtime.DEFAULT_PORT,8787)
   with patch.dict(os.environ,{'PORTRAIT_STUDIO_DATA':d}):self.assertEqual(runtime.data_dir(),root.resolve())
