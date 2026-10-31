"""Explicit connection registry. Unverified integrations are never advertised as ready."""
import os,shutil
from pathlib import Path

def find_codex():
    found=shutil.which('codex')
    if found:return found
    candidates=[Path.home()/'.local/bin/codex',Path('/opt/homebrew/bin/codex'),Path('/usr/local/bin/codex')]
    if os.name=='nt':candidates += [Path(os.environ.get('LOCALAPPDATA',''))/'Programs/codex/codex.exe',Path(os.environ.get('APPDATA',''))/'npm/codex.cmd']
    return next((str(p) for p in candidates if p.is_file() and os.access(p,os.X_OK)),None)

def create_connection(name,cwd):
    if name=='lovart-direct':
        from lovart_direct import LovartDirect
        return LovartDirect(cwd)
    if name=='libtv-direct':
        from libtv_direct import LibTVBridge
        return LibTVBridge(cwd)
    if name!='codex-lovart':raise ValueError('该连接器尚未完成适配，请使用已验证的连接方式')
    from bridge import CodexBridge
    return CodexBridge(cwd)
