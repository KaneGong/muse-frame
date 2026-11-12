"""Check the public source boundary without printing any matching secret values."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_DIRECTORIES = {
    'work', 'data', 'outputs', 'tokens', 'node_modules', '.venv', '__pycache__',
    '验证截图', 'costume-thumbs', 'costume-full',
}
PUBLIC_CATALOGS = {
    Path('design/muse-frame-04/data/costumes.json'),
    Path('design/muse-frame-04/data/library.json'),
    Path('design/muse-frame-04/data/scenes.json'),
}
LEGACY_LINK = Path('design/muse-frame-04/legacy')
LEGACY_TARGET = Path('design/muse-frame-next')


def source_files():
    try:
        git = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True)
    except FileNotFoundError:
        git = None
    if git and git.returncode == 0 and git.stdout:
        return [ROOT / os.fsdecode(name) for name in git.stdout.split(b'\0') if name]

    # An extracted release archive has no Git index. Inspect every included
    # file and symlink, including anything under a normally ignored directory.
    files = []
    for directory, children, names in os.walk(ROOT):
        folder = Path(directory)
        for name in list(children):
            child = folder / name
            if name == '.git' or child.is_symlink():
                children.remove(name)
                if name != '.git':
                    files.append(child)
        files.extend(folder / name for name in names if name != '.git')
    return sorted(files)


def reviewed_legacy_link(path, relative):
    target = ROOT / LEGACY_TARGET
    return (
        relative == LEGACY_LINK
        and os.readlink(path) == '../muse-frame-next'
        and target.is_dir()
        and target.resolve() == target
    )


def audit():
    problems=[];files=source_files()
    private_path=re.compile('/'+'Users/'+r'[^/\s]+/|/'+'home/'+r'[^/\s]+/')
    secret=re.compile(r'sk-'+'proj-'+r'[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN '+r'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
    for p in files:
        rel=p.relative_to(ROOT);parts=rel.parts
        if PRIVATE_DIRECTORIES.intersection(parts) and rel not in PUBLIC_CATALOGS:
            problems.append({'path':str(rel),'reason':'private/build directory in source'})
            continue
        if p.is_symlink():
            if not reviewed_legacy_link(p, rel):
                problems.append({'path':str(rel),'reason':'source symlink needs explicit review'})
            continue
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
