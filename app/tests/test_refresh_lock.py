import sys,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import libtv_direct

class RefreshLockTests(unittest.TestCase):
 def test_unix_lock_serializes_independent_callers(self):
  if libtv_direct.os.name=='nt':self.skipTest('Unix lock test')
  with tempfile.TemporaryDirectory() as root:
   path=str(Path(root)/'lock');entered=threading.Event();release=threading.Event();second=threading.Event()
   def first():
    with libtv_direct._refresh_lock(path):entered.set();release.wait(2)
   def other():
    with libtv_direct._refresh_lock(path):second.set()
   a=threading.Thread(target=first);b=threading.Thread(target=other);a.start();self.assertTrue(entered.wait(2));b.start();self.assertFalse(second.wait(.05));release.set();a.join(2);b.join(2);self.assertTrue(second.is_set())
 def test_windows_lock_uses_same_byte_and_releases(self):
  calls=[];fake=types.SimpleNamespace(LK_LOCK=1,LK_UNLCK=2,locking=lambda fd,mode,count:calls.append((mode,count)))
  with tempfile.TemporaryDirectory() as root:
   path=str(Path(root)/'lock')
   with patch.object(libtv_direct.os,'name','nt'),patch.dict(sys.modules,{'msvcrt':fake}):
    with libtv_direct._refresh_lock(path):self.assertEqual(calls,[(1,1)])
   self.assertEqual(calls,[(1,1),(2,1)])
if __name__=='__main__':unittest.main()
