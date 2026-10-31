"""Build an isolated Windows test package on Windows.

Run with the project virtual environment after installing requirements.txt and
requirements-build-standalone.txt. The result is an unsigned test build; it
requires Windows testing and signing before public distribution.
"""
import os,platform,shutil,subprocess,sys,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=ROOT/'app'
OUT=ROOT/'outputs'/'windows-test'
WORK=ROOT/'work'/'pyinstaller-windows'


def build():
    if platform.system()!='Windows':
        raise SystemExit('Windows builds must run on Windows; cross-building is not supported.')
    OUT.mkdir(parents=True,exist_ok=True);WORK.mkdir(parents=True,exist_ok=True)
    # Third-party gallery image data is excluded; previews come from its source.
    with tempfile.TemporaryDirectory(prefix='muse-win-static-',dir=ROOT/'work') as stage:
        static=Path(stage)/'static'
        shutil.copytree(APP/'static',static,ignore=shutil.ignore_patterns('costume-thumbs','costume-full'))
        command=[sys.executable,'-m','PyInstaller','--noconfirm','--windowed',
                 '--name','MUSE FRAME','--paths',str(APP),'--distpath',str(OUT),
                 '--workpath',str(WORK),'--specpath',str(WORK),
                 '--icon',str(APP/'muse-frame.ico'),
                 '--add-data',str(static)+os.pathsep+'static',
                 '--add-data',str(APP/'standalone-edition')+os.pathsep+'.']
        for module in ('libtv_direct','lovart_direct','token_store','platforms','face_gallery'):
            command+=['--hidden-import',module]
        command.append(str(APP/'desktop.py'))
        subprocess.run(command,cwd=ROOT,check=True)
    return OUT/'MUSE FRAME'/'MUSE FRAME.exe'

if __name__=='__main__':
    print('Unsigned Windows test build:',build())
