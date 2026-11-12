"""Portable workspace media paths and their file-system bounds."""
from pathlib import PurePosixPath
from urllib.parse import quote


def portable_workspace_path(value):
    if not isinstance(value, str) or not value or '\0' in value or ':' in value:
        raise ValueError('图片文件路径无效')
    path = PurePosixPath(value.replace('\\', '/'))
    if path.is_absolute() or not path.parts or '..' in path.parts:
        raise ValueError('图片文件路径无效')
    return path.as_posix()


def portable_media_path(value):
    relative = portable_workspace_path(value)
    if not relative.startswith(('assets/', 'previews/')):
        raise ValueError('图片文件路径无效')
    return relative


def resolved_workspace_path(root, relative):
    path = (root / portable_workspace_path(relative)).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('图片文件路径无效')
    return path


def resolved_media_path(root, relative):
    relative = portable_media_path(relative)
    base = resolved_workspace_path(root, relative.split('/', 1)[0])
    path = resolved_workspace_path(root, relative)
    if path == base or not path.is_relative_to(base):
        raise ValueError('图片文件路径无效')
    return path


def media_url(relative, project_id):
    return '/files/' + quote(portable_workspace_path(relative), safe='/') + '?project_id=' + quote(project_id, safe='')


def _normalize_fields(data, fields):
    for field in fields:
        if data.get(field):
            try:
                data[field] = portable_workspace_path(data[field])
            except ValueError:
                pass
    return data


def normalize_asset_media(data):
    _normalize_fields(data, ('local', 'original_local'))
    if isinstance(data.get('photo_adjustment'), dict):
        data['photo_adjustment'] = _normalize_fields(data['photo_adjustment'].copy(), ('base_local', 'local'))
    return data
