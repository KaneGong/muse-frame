import importlib.util,os,shutil,tempfile,unittest
from pathlib import Path
from unittest.mock import patch

class LocalProfileTests(unittest.TestCase):
 def load(self,root):
  spec=importlib.util.spec_from_file_location('isolated_profile_runtime',root/'runtime.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
 def test_packaged_opt_in_profile_uses_empty_directory_without_repointing_general_users(self):
  with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{},clear=True):
   root=Path(tmp);shutil.copy2(Path(__file__).parents[1]/'runtime.py',root/'runtime.py');(root/'standalone-edition').touch()
   app=root/'QA.app/Contents';(app/'Resources').mkdir(parents=True);runtime=self.load(root)
   with patch.object(runtime.sys,'frozen',True,create=True),patch.object(runtime.sys,'platform','darwin'),patch.object(runtime.sys,'executable',str(app/'MacOS/QA')),patch.object(runtime.Path,'home',return_value=root):
    legacy=root/'Library/Application Support/AI Portrait Studio Standalone'
    self.assertEqual(runtime.data_dir(),legacy)
    (app/'Resources/local-data-profile').write_text('prompt-v2\n')
    self.assertEqual(runtime.data_dir(),root/'Library/Application Support/AI Portrait Studio Standalone Prompt V2')
    self.assertFalse(runtime.data_dir().exists());self.assertFalse(legacy.exists())
    with patch.dict(os.environ,{'PORTRAIT_STUDIO_DATA':str(root/'explicit')}):self.assertEqual(runtime.data_dir(),(root/'explicit').resolve())
