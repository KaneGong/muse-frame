"""Portable application identity and user-owned data locations."""
import os,sys,shutil,tomllib
from pathlib import Path

_HERE=Path(__file__).parent
if (_HERE/'private-edition').is_file():EDITION='private'
elif (_HERE/'standalone-edition').is_file():EDITION='standalone'
else:EDITION='open'
EDITION_NAME={'private':'私有版','standalone':'独立版','open':'开放版'}[EDITION]
APP_ID='ai-portrait-studio'
APP_NAME='映象所' if EDITION=='standalone' else 'AI人像摄影 Studio'
ENGLISH_NAME='MUSE FRAME' if EDITION=='standalone' else 'AI Portrait Studio'
VERSION='0.5.0-beta.5' if EDITION=='standalone' else '0.3.3-alpha.1'
DEFAULT_PORT={'private':8766,'standalone':8765,'open':8787}[EDITION]
# Standalone owns its platform connection: no Codex CLI, no Agent session.
DEFAULT_CONNECTION={'private':'codex-lovart','standalone':'lovart-direct','open':'codex-lovart'}[EDITION]

def data_dir():
    if os.environ.get('PORTRAIT_STUDIO_DATA'):
        return Path(os.environ['PORTRAIT_STUDIO_DATA']).expanduser().resolve()
    if EDITION=='private':
        return Path(__file__).resolve().parent.parent/'portrait-workbench-v1/data'
    if EDITION=='standalone':
        # A source checkout keeps its data beside the project; the packaged app
        # must never write inside its own bundle, so it uses the OS data folder.
        if not getattr(sys,'frozen',False):
            return Path(__file__).resolve().parent.parent/'data'
        if sys.platform=='win32':
            return Path(os.environ.get('LOCALAPPDATA',Path.home()/'AppData/Local'))/'AI Portrait Studio Standalone'
        if sys.platform=='darwin':
            # Local opt-in preview only. Published builds without this marker
            # retain the existing directory; never erase or migrate it silently.
            marker=Path(sys.executable).parent.parent/'Resources/local-data-profile'
            profile=marker.read_text().strip() if marker.is_file() else ''
            name='AI Portrait Studio Standalone Prompt V2' if profile=='prompt-v2' else 'AI Portrait Studio Standalone'
            return Path.home()/'Library/Application Support'/name
        return Path(os.environ.get('XDG_DATA_HOME',Path.home()/'.local/share'))/APP_ID
    if sys.platform=='win32':
        return Path(os.environ.get('LOCALAPPDATA',Path.home()/'AppData/Local'))/'AI Portrait Studio'
    if sys.platform=='darwin':return Path.home()/'Library/Application Support/AI Portrait Studio'
    return Path(os.environ.get('XDG_DATA_HOME',Path.home()/'.local/share'))/APP_ID

def _codex_connection():
    from connections import find_codex
    executable=find_codex();configured=False;config_error=False
    config=Path.home()/'.codex/config.toml'
    if config.is_file():
        try:
            server=tomllib.loads(config.read_text()).get('mcp_servers',{}).get('lovart')
            configured=isinstance(server,dict) and server.get('enabled',True) is not False
        except (OSError,ValueError):config_error=True
    # Never return config contents, credential locations, tokens, URLs or headers.
    return {'id':'codex-lovart','name':'Codex → Lovart','installed':bool(executable),
        'configuration_found':configured,'configuration_error':config_error,
        'status':'needs_check' if executable else 'missing_agent',
        'note':'检测到程序不代表已连接；请点击连接并完成必要授权。' if executable else '尚未检测到 Codex。可先建立项目、整理参考和预设；生图需要完成连接。'}

def _standalone_connection():
    from lovart_direct import default_token_path
    token=default_token_path()
    present=token.is_file()
    return {'id':'lovart-direct','name':'Lovart 直连（独立版）','installed':present,
        'configuration_found':present,'configuration_error':False,
        'status':'needs_check' if present else 'missing_agent',
        'note':'点击连接即可验证平台工具；失败会显示具体错误码。' if present else
               '尚未完成 Lovart 授权：在 app 目录运行 python3 lovart_direct.py --login，再回来点击连接。'}

def diagnostics():
    connection=_standalone_connection() if EDITION=='standalone' else _codex_connection()
    return {'app_id':APP_ID,'name':APP_NAME,'english_name':ENGLISH_NAME,'version':VERSION,
        'edition':EDITION,'edition_name':EDITION_NAME,
        'packaged':bool(getattr(sys,'frozen',False)),
        'connection':connection,
        'other_agents':{'status':'available','note':'通用本机MCP仍可用于姿态识图等可选能力；生图不再依赖任何 Agent。'}}
