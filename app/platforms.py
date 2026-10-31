"""Which image platform the workbench talks to, and how to reach it."""
import json
import os
import urllib.parse
from pathlib import Path

PLATFORMS = [
    {'id': 'lovart', 'name': 'Lovart', 'connector': 'lovart-direct',
     'note': '海外平台，需要能访问 lovart.ai；模型目录由平台实时返回。',
     'auth': 'oauth-lovart'},
    {'id': 'libtv', 'name': 'LibTV', 'connector': 'libtv-direct',
     'note': '国内平台，无需代理；支持签名上传本机图片与多图参考。',
     'auth': 'oauth-libtv'},
]
DEFAULT = 'lovart'


def _entry(platform_id):
    return next((item for item in PLATFORMS if item['id'] == platform_id), None)


def load(root):
    """Read the chosen platform; unknown values fall back to the default."""
    try:
        config = json.loads((Path(root) / 'platform.json').read_text())
    except (OSError, ValueError):
        config = {}
    chosen = config.get('platform') or os.environ.get('PORTRAIT_PLATFORM') or DEFAULT
    return chosen if _entry(chosen) else DEFAULT


def save(root, platform_id):
    if not _entry(platform_id):
        raise ValueError('没有这个绘图平台：' + str(platform_id))
    (Path(root) / 'platform.json').write_text(
        json.dumps({'platform': platform_id}, ensure_ascii=False, indent=2))
    return platform_id


def connector(platform_id):
    entry = _entry(platform_id)
    if not entry:
        raise ValueError('没有这个绘图平台：' + str(platform_id))
    return entry['connector']


def name(platform_id):
    entry = _entry(platform_id)
    return entry['name'] if entry else platform_id


def listing():
    return [dict(item) for item in PLATFORMS]


# Image URLs the workbench will store or download must come from one of the
# configured platforms. Keep this a host suffix list, not a single vendor.
IMAGE_HOSTS = ('lovart.ai', 'liblib.art', 'liblib.tv', 'liblib.cloud')


def allow_image_url(url):
    try:
        parsed = urllib.parse.urlparse(str(url or ''))
    except ValueError:
        return False
    if parsed.scheme != 'https' or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    return any(host == suffix or host.endswith('.' + suffix) for suffix in IMAGE_HOSTS)
