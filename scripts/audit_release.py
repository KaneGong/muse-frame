"""Check the public source boundary without printing any matching secret values."""
import json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
IGNORE={'.git','.venv','node_modules','outputs','work','data','__pycache__'}
def source_files():
    git=subprocess.run(['git','ls-files','-z'],cwd=ROOT,capture_output=True)
    if git.returncode==0 and git.stdout:
        return [ROOT/p for p in git.stdout.decode().split('\0') if p]
    return [p for p in ROOT.rglob('*') if p.is_file() and not IGNORE.intersection(p.relative_to(ROOT).parts)]
def audit():
    problems=[];files=source_files()
    private_path=re.compile('/'+'Users/'+r'[^/\s]+/|/'+'home/'+r'[^/\s]+/')
    secret=re.compile(r'sk-'+'proj-'+r'[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN '+r'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
    for p in files:
        rel=p.relative_to(ROOT);parts=rel.parts
        if any(t in {'work','data','outputs','tokens','node_modules','.venv','__pycache__','验证截图','costume-thumbs','costume-full'} for t in parts):problems.append({'path':str(rel),'reason':'private/build directory in source'});continue
        if p.is_symlink():problems.append({'path':str(rel),'reason':'source symlink needs explicit review'});continue
        if p.suffix.lower() in {'.db','.sqlite','.sqlite3','.wal','.shm','.log','.key','.pyc','.pkg','.zip','.dmg','.dylib','.so'} or p.name in {'sample.json','.env'}:problems.append({'path':str(rel),'reason':'private/generated artifact in source'});continue
        if p.suffix.lower() in {'.png','.jpg','.webp','.ico','.icns'}:continue
        try:text=p.read_text()
        except UnicodeError:problems.append({'path':str(rel),'reason':'unexpected binary'});continue
        for i,line in enumerate(text.splitlines(),1):
            if private_path.search(line) or secret.search(line):problems.append({'path':str(rel),'line':i,'reason':'private path or credential-like text'})
    for name in ['LICENSE','COPYRIGHT','README.md','README.zh-CN.md','THIRD_PARTY_NOTICES.md','ASSET_LICENSES.md','licenses/manifest.json','VERSION','package-lock.json']:
        if not (ROOT/name).is_file():problems.append({'path':name,'reason':'missing release source file'})
    if 'GNU AFFERO GENERAL PUBLIC LICENSE' not in (ROOT/'LICENSE').read_text():problems.append({'path':'LICENSE','reason':'wrong license'})
    version=(ROOT/'VERSION').read_text().strip()
    package=json.loads((ROOT/'package.json').read_text())
    if package['version']!=version or package['license']!='AGPL-3.0-only':problems.append({'path':'package.json','reason':'version/license mismatch'})
    for item in json.loads((ROOT/'licenses/manifest.json').read_text()):
        if not item['notice_files'] or any(not (ROOT/n).is_file() for n in item['notice_files']):problems.append({'path':item['name'],'reason':'missing dependency notice'})
    result={'source_files':len(files),'version':version,'problems':problems}
    print(json.dumps(result,ensure_ascii=False,indent=2));return result
if __name__=='__main__':sys.exit(bool(audit()['problems']))
