"""Credentials owned by the standalone app, not borrowed from another tool.

Stage 1 of the standalone edition reused DeepSeek Harness' MCP token directory
(~/.dsh/mcp-tokens), which meant uninstalling or resetting DSH would silently
break platform login. This module gives the standalone edition its own token
directory inside the app data folder:

    <data>/tokens/libtv.json, libtv-client.json, lovart.json

Existing app-owned credentials remain usable. Fresh installations do not copy
credentials from another application or log in automatically. Other editions
keep their existing location untouched.

Override precedence for tests and power users:
    PORTRAIT_TOKEN_DIR        explicit token directory (wins)
    PORTRAIT_LEGACY_TOKEN_DIR legacy directory used for bootstrapping/tests
"""
import json
import os
import shutil
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent
BOOTSTRAP_FILES = ('libtv.json', 'libtv-client.json', 'lovart.json')


def standalone():
    return (_HERE / 'standalone-edition').is_file() or os.environ.get('PORTRAIT_STANDALONE') == '1'


def default_data_root():
    try:
        import runtime
        return runtime.data_dir()
    except Exception:
        return _HERE.parent / 'data'


def legacy_dir():
    override = os.environ.get('PORTRAIT_LEGACY_TOKEN_DIR')
    if override:
        return Path(override).expanduser()
    return Path.home() / '.dsh' / 'mcp-tokens'


def directory(data_root=None):
    override = os.environ.get('PORTRAIT_TOKEN_DIR')
    if override:
        return Path(override).expanduser()
    if standalone():
        return Path(data_root or default_data_root()) / 'tokens'
    return legacy_dir()


def path(name, data_root=None):
    return directory(data_root) / name


def ensure(data_root, bootstrap=False):
    """Prepare the standalone credential directory without automatic migration.

    Returns {'directory': str, 'migrated': [names]}. Never raises: a missing or
    unreadable legacy directory only means the user authorizes in the app.
    """
    target = directory(data_root)
    try:
        target.mkdir(parents=True, exist_ok=True)
        os.chmod(target, 0o700)
    except OSError:
        pass
    os.environ['PORTRAIT_TOKEN_DIR'] = str(target)
    migrated = []
    if not bootstrap:return {'directory': str(target), 'migrated': migrated}
    legacy = legacy_dir()
    try:
        same = target.resolve() == legacy.resolve()
    except OSError:
        same = False
    if not same:
        for name in BOOTSTRAP_FILES:
            source = legacy / name
            destination = target / name
            if destination.exists() or not source.is_file():
                continue
            temporary = destination.with_name(destination.name + '.tmp')
            try:
                shutil.copyfile(source, temporary)
                os.chmod(temporary, 0o600)
                os.replace(temporary, destination)
                migrated.append(name)
            except OSError:
                try:
                    temporary.unlink()
                except OSError:
                    pass
    return {'directory': str(target), 'migrated': migrated}


def info(data_root=None):
    """Secret-free description for diagnostics: paths and expiry only."""
    current = directory(data_root)
    legacy = legacy_dir()
    result = {
        'directory': str(current),
        'legacy_directory': str(legacy),
        'standalone': standalone(),
        'own': _same(current, legacy) is False,
        'files': {},
    }
    for name in BOOTSTRAP_FILES:
        location = current / name
        entry = {'present': location.is_file()}
        if entry['present']:
            try:
                data = json.loads(location.read_text())
            except (OSError, ValueError):
                data = {}
            expires = data.get('expires_at')
            if isinstance(expires, (int, float)):
                entry['expires_at'] = expires
                entry['expires'] = time.strftime('%Y-%m-%d %H:%M', time.localtime(expires))
        result['files'][name] = entry
    return result


def _same(left, right):
    try:
        return Path(left).resolve() == Path(right).resolve()
    except OSError:
        return False
