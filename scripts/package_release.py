"""Create an auditable source archive and macOS DMG from reviewed tracked source."""
import argparse,hashlib,json,plistlib,shutil,subprocess,sys,tempfile,zipfile
from pathlib import Path
from audit_release import ROOT,audit

def package(app,out):
    if sys.platform!='darwin':raise SystemExit('Build the macOS release on macOS.')
    if audit()['problems']:raise SystemExit('Source audit failed.')
    version=(ROOT/'VERSION').read_text().strip();info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
    if info.get('CFBundleGetInfoString')!=version:raise SystemExit('The App and source version do not match.')
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    architecture=subprocess.check_output(['file',str(app/'Contents/MacOS/AI Portrait Studio')],text=True)
    if 'arm64' not in architecture:raise SystemExit('This release target is Apple Silicon arm64.')
    files=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0');files=sorted(p for p in files if p)
    if not files:raise SystemExit('Stage the reviewed source in Git first.')
    out.mkdir(parents=True,exist_ok=True);source=out/f'MuseFrame-{version}-source.zip';manifest=[]
    with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for rel in files:
            p=ROOT/rel;data=p.read_bytes();entry=zipfile.ZipInfo(f'muse-frame-{version}/'+rel,date_time=(2026,11,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=(0o100644<<16);z.writestr(entry,data);manifest.append({'path':rel,'sha256':hashlib.sha256(data).hexdigest()})
    (out/'SOURCE-MANIFEST.json').write_text(json.dumps({'version':version,'files':manifest},indent=2)+'\n')
    with tempfile.TemporaryDirectory(prefix='muse-dmg-',dir=ROOT/'work') as tmp:
        staging=Path(tmp);subprocess.run(['ditto',str(app),str(staging/'MUSE FRAME.app')],check=True)
        (staging/'Applications').symlink_to('/Applications',target_is_directory=True)
        legal=staging/'Sources and Licenses';legal.mkdir();shutil.copy2(source,legal/source.name)
        for name in ['LICENSE','COPYRIGHT','THIRD_PARTY_NOTICES.md','ASSET_LICENSES.md','TRADEMARKS.md']:shutil.copy2(ROOT/name,legal/name)
        shutil.copytree(ROOT/'licenses',legal/'licenses')
        (staging/'READ ME - 请先阅读.txt').write_text('MUSE FRAME '+version+' — Community preview / 社区预览\n\nCopy MUSE FRAME.app to Applications, then open it.\n将 MUSE FRAME.app 拖入 Applications 后再打开。\n\nmacOS 26+ and Apple Silicon only. Ad-hoc signed; NOT Apple-notarized.\n当前要求 macOS 26 及以上、Apple Silicon，临时签名，未经过 Apple 公证。\nhttps://support.apple.com/en-us/102445\n\nUse your own Lovart or LibTV account. Generation consumes provider credits.\n请使用自己的平台账号，生成消耗对应平台额度。\n\nSource and license: Sources and Licenses folder, and\nhttps://github.com/KaneGong/muse-frame\n\nDo not overwrite an App while it is generating or saving.\n请先保存并退出旧版，再替换安装。\n')
        dmg=out/f'MuseFrame-{version}-macos-arm64.dmg'
        subprocess.run(['hdiutil','create','-volname','MUSE FRAME '+version,'-srcfolder',str(staging),'-format','UDZO','-fs','HFS+','-ov',str(dmg)],check=True)
    shutil.copy2(ROOT/'RELEASE_NOTES.md',out/'RELEASE_NOTES.md')
    hashes=[]
    for p in [source,dmg,out/'SOURCE-MANIFEST.json']:hashes.append(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name)
    (out/'SHA256SUMS.txt').write_text('\n'.join(hashes)+'\n');return {'version':version,'source':str(source),'dmg':str(dmg),'files':len(files)}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--app',type=Path,default=ROOT/'outputs/standalone-app/AI Portrait Studio.app');p.add_argument('--out',type=Path,default=ROOT/'outputs/release');a=p.parse_args();print(json.dumps(package(a.app.resolve(),a.out.resolve()),indent=2))
