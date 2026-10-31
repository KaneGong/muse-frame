import os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import token_store,libtv_direct,lovart_direct

class TokenStoreTests(unittest.TestCase):
 def env(self,**values):
  for key in ['PORTRAIT_TOKEN_DIR','PORTRAIT_LEGACY_TOKEN_DIR','PORTRAIT_LOVART_TOKEN']:os.environ.pop(key,None)
  os.environ.update(values)

 def test_standalone_owns_tokens_inside_its_data_directory(self):
  self.env();self.addCleanup(self.env)
  with tempfile.TemporaryDirectory() as d,patch.object(token_store,'standalone',return_value=True):
   self.assertEqual(token_store.directory(d),Path(d)/'tokens')
   self.assertEqual(token_store.path('libtv.json',d),Path(d)/'tokens'/'libtv.json')

 def test_other_editions_keep_the_legacy_location(self):
  self.env(PORTRAIT_LEGACY_TOKEN_DIR='/tmp/legacy-tokens');self.addCleanup(self.env)
  with patch.object(token_store,'standalone',return_value=False):
   self.assertEqual(token_store.directory(),Path('/tmp/legacy-tokens'))
   self.assertEqual(token_store.path('lovart.json'),Path('/tmp/legacy-tokens/lovart.json'))

 def test_ensure_copies_a_legacy_login_once_and_never_overwrites_the_app_copy(self):
  with tempfile.TemporaryDirectory() as d:
   legacy=Path(d)/'legacy';data=Path(d)/'data';legacy.mkdir()
   (legacy/'libtv.json').write_text('{"access_token":"a"}');(legacy/'lovart.json').write_text('{"refresh_token":"r"}')
   self.env(PORTRAIT_LEGACY_TOKEN_DIR=str(legacy))
   with patch.object(token_store,'standalone',return_value=True):
    result=token_store.ensure(data,bootstrap=True)
    self.assertEqual(set(result['migrated']),{'libtv.json','lovart.json'})
    self.assertEqual(result['directory'],str(data/'tokens'))
    self.assertEqual(os.environ['PORTRAIT_TOKEN_DIR'],str(data/'tokens'))
    self.assertTrue((legacy/'libtv.json').is_file())
    self.assertEqual((data/'tokens'/'libtv.json').stat().st_mode&0o777,0o600)
    (data/'tokens'/'libtv.json').write_text('{"access_token":"own"}')
    again=token_store.ensure(data,bootstrap=True)
    self.assertEqual(again['migrated'],[])
    self.assertIn('own',(data/'tokens'/'libtv.json').read_text())
  self.addCleanup(self.env)

 def test_fresh_install_never_automatically_copies_legacy_credentials(self):
  with tempfile.TemporaryDirectory() as d:
   legacy=Path(d)/'legacy';legacy.mkdir();(legacy/'libtv.json').write_text('synthetic test content')
   self.env(PORTRAIT_LEGACY_TOKEN_DIR=str(legacy));self.addCleanup(self.env)
   result=token_store.ensure(Path(d)/'new-app')
   self.assertEqual(result['migrated'],[])
   self.assertFalse((Path(d)/'new-app'/'tokens'/'libtv.json').exists())
   self.assertTrue((legacy/'libtv.json').exists())

 def test_app_tokens_are_used_without_the_dsh_directory(self):
  with tempfile.TemporaryDirectory() as d:
   self.env(PORTRAIT_TOKEN_DIR=d, PORTRAIT_LEGACY_TOKEN_DIR=str(Path(d)/'missing'))
   self.assertFalse((Path(d)/'missing').exists())
   self.assertEqual(libtv_direct._token_path(),str(Path(d)/'libtv.json'))
   self.assertEqual(libtv_direct._node_map_path(),str(Path(d)/'libtv-nodes.json'))
   self.assertEqual(lovart_direct.default_token_path(),Path(d)/'lovart.json')

 def test_explicit_lovart_token_path_still_wins(self):
  with tempfile.TemporaryDirectory() as d:
   self.env(PORTRAIT_TOKEN_DIR=d,PORTRAIT_LOVART_TOKEN=str(Path(d)/'custom.json'))
   self.assertEqual(lovart_direct.default_token_path(),Path(d)/'custom.json')
  self.addCleanup(self.env)

 def test_info_exposes_paths_and_expiry_but_never_secret_values(self):
  with tempfile.TemporaryDirectory() as d:
   self.env(PORTRAIT_TOKEN_DIR=d)
   (Path(d)/'libtv.json').write_text('{"access_token":"SECRET-ACCESS","refresh_token":"SECRET-REFRESH","expires_at":1700000000}')
   info=token_store.info(Path(d))
   rendered=str(info)
   self.assertNotIn('SECRET-ACCESS',rendered);self.assertNotIn('SECRET-REFRESH',rendered)
   self.assertEqual(info['directory'],d)
   self.assertTrue(info['files']['libtv.json']['present'])
   self.assertIn('expires',info['files']['libtv.json'])
   self.assertFalse(info['files']['lovart.json']['present'])
  self.addCleanup(self.env)
