"""Build the standalone macOS app: a native window plus the whole backend.

Output: outputs/standalone-app/AI Portrait Studio.app (unsigned/ad-hoc).
No network, account or Agent is needed to build; PyInstaller and pywebview are
build-time dependencies (requirements-build-standalone.txt).
"""
import argparse
import json
import platform
import re
import plistlib
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app'
OUTPUT = ROOT / 'outputs' / 'standalone-app'
WORK = ROOT / 'work' / 'pyinstaller-standalone'
SPEC = ROOT / 'work'
ICON = APP / 'muse-frame.icns'
BUNDLE_ID = 'studio.portrait.standalone'
HIDDEN = ['libtv_direct', 'lovart_direct', 'vision_direct', 'token_store', 'platforms']
EXCLUDES = ['tkinter', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'gi']


def _version():
    sys.path.insert(0, str(APP))
    from runtime import VERSION
    return VERSION


def bundle_minimum_macos(app):
    """Honor native deployment targets rather than promising an older macOS."""
    minimum=(12,0);seen=set()
    for path in app.rglob('*'):
        if not path.is_file() or path.resolve() in seen:continue
        seen.add(path.resolve())
        with path.open('rb') as handle:magic=handle.read(4)
        if magic not in (bytes.fromhex('cffaedfe'),bytes.fromhex('feedfacf'),bytes.fromhex('cafebabe'),bytes.fromhex('bebafeca')):continue
        output=subprocess.check_output(['otool','-l',str(path)],text=True)
        versions=re.findall(r'\bminos\s+(\d+(?:\.\d+){1,2})',output)
        versions+=re.findall(r'LC_VERSION_MIN_MACOSX\s+cmdsize\s+\d+\s+version\s+(\d+(?:\.\d+){1,2})',output)
        for value in versions:minimum=max(minimum,tuple(map(int,value.split('.'))))
    return '.'.join(map(str,minimum))


def build(clean=True):
    if platform.system() != 'Darwin':
        raise SystemExit('The window wrapper is macOS-only for now; build the source on the target OS.')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    # The external gallery author does not allow redistribution of image data.
    # Keep any developer-local thumbnails untouched but exclude them from builds.
    static_stage = tempfile.TemporaryDirectory(prefix='muse-static-', dir=ROOT / 'work')
    staged_static = Path(static_stage.name) / 'static'
    shutil.copytree(APP / 'static', staged_static, ignore=shutil.ignore_patterns('costume-thumbs','costume-full'))
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm',
               '--paths', str(APP),
               '--distpath', str(OUTPUT), '--workpath', str(WORK), '--specpath', str(SPEC),
               '--name', 'AI Portrait Studio',
               '--windowed',
               '--osx-bundle-identifier', BUNDLE_ID,
               '--add-data', '%s:static' % staged_static,
               '--add-data', '%s:.' % (APP / 'standalone-edition'),
               ]
    if ICON.is_file():
        command += ['--icon', str(ICON)]
    for name in HIDDEN:
        command += ['--hidden-import', name]
    for name in EXCLUDES:
        command += ['--exclude-module', name]
    if clean:
        command.insert(4, '--clean')
    for name in ['LICENSE','COPYRIGHT','THIRD_PARTY_NOTICES.md','ASSET_LICENSES.md','TRADEMARKS.md','licenses']:
        if (ROOT/name).exists():command += ['--add-data', '%s:%s' % (ROOT/name, 'legal/licenses' if name=='licenses' else 'legal')]
    command.append(str(APP / 'desktop.py'))
    try:
        subprocess.run(command, cwd=ROOT, check=True)
    finally:
        static_stage.cleanup()

    app = OUTPUT / 'AI Portrait Studio.app'
    if not app.is_dir():
        raise SystemExit('PyInstaller did not produce the app bundle')
    info_path = app / 'Contents' / 'Info.plist'
    with info_path.open('rb') as handle:
        info = plistlib.load(handle)
    version = _version()
    info.update({
        'CFBundleDisplayName': '映象所 · MUSE FRAME',
        'CFBundleName': 'MUSE FRAME',
        'CFBundleIdentifier': BUNDLE_ID,
        'CFBundleShortVersionString': version.split('-')[0],
        'CFBundleVersion': '0.4.1001' if version=='0.4.0-beta.1' else version.split('-')[0],
        'CFBundleGetInfoString': version,
        'LSApplicationCategoryType': 'public.app-category.photography',
        'LSMinimumSystemVersion': bundle_minimum_macos(app),
        'NSHighResolutionCapable': True,
        'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
    })
    with info_path.open('wb') as handle:
        plistlib.dump(info, handle)
    subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
    metadata = {
        'name': '映象所 · MUSE FRAME',
        'edition': 'standalone',
        'version': version,
        'bundle_id': BUNDLE_ID,
        'system': platform.system(),
        'architecture': platform.machine(),
        'python': platform.python_version(),
        'signed': 'ad-hoc',
        'data_directory': '~/Library/Application Support/AI Portrait Studio Standalone',
        'note': 'Developer ID signing and notarization are still pending for public distribution.',
    }
    (OUTPUT / 'BUILD-INFO.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(metadata, ensure_ascii=False, indent=2))
    return app


def install(source=None, target=None, migrate=None):
    """Stage and verify the app, retaining a recoverable copy of any previous app."""
    source = Path(source or OUTPUT / 'AI Portrait Studio.app')
    target = Path(target or Path.home() / 'Applications' / 'AI Portrait Studio.app')
    target.parent.mkdir(parents=True, exist_ok=True)
    result = {'app': str(target)}
    with tempfile.TemporaryDirectory(prefix='.muse-install-', dir=target.parent) as stage:
        candidate = Path(stage) / target.name
        subprocess.run(['ditto', str(source), str(candidate)], check=True)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(candidate)], check=True)
        backup = target.parent / ('.' + target.stem + '-backup-' + uuid.uuid4().hex + target.suffix)
        had_previous = target.exists()
        if had_previous:
            target.rename(backup)
        try:
            candidate.rename(target)
        except Exception:
            if had_previous:
                backup.rename(target)
            raise
        if had_previous:
            result['previous_app_backup'] = str(backup)
    if migrate:
        source_data = Path(migrate)
        destination = Path.home() / 'Library' / 'Application Support' / 'AI Portrait Studio Standalone'
        if destination.exists() and any(destination.iterdir()):
            result['migrated'] = False
            result['reason'] = 'target data directory already exists'
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            # APFS clone keeps the 1GB copy instant on the same volume.
            subprocess.run(['cp', '-Rc', str(source_data), str(destination)], check=True)
            result['migrated'] = True
            result['data'] = str(destination)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build the standalone macOS app')
    parser.add_argument('--no-clean', action='store_true')
    parser.add_argument('--install', action='store_true', help='copy the app to ~/Applications')
    parser.add_argument('--migrate-data', type=Path, default=None,
                        help='copy this data directory into the app data directory on first install')
    args = parser.parse_args()
    app = build(clean=not args.no_clean)
    if args.install:
        install(app, migrate=args.migrate_data)
