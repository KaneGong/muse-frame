"""Save an export only inside a folder explicitly picked in the system dialog."""
import base64
import errno
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from urllib.parse import unquote

MAX_EXPORT = 512 * 1024 * 1024
PICKER_LOCK = threading.Lock()
ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".zip", ".json"}


def export_name(header):
    name = unquote(header or "")
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError("不支持这个导出文件类型")
    stem = re.sub(r'[\\/:"<>|?*\x00-\x1f\x7f]', "-", name[:-len(suffix)]).strip(". ")
    if sys.platform == "win32" and re.fullmatch(r"CON|PRN|AUX|NUL|(?:COM|LPT)[1-9¹²³]", stem.split(".")[0], re.I):
        stem = "_" + stem
    while len(stem.encode("utf-8")) > 170:
        stem = stem[:-1]
    return (stem or "MuseFrame") + suffix


def choose_folder(purpose="export"):
    prompt = ("选择旧版 Muse Frame 的数据文件夹 / Choose a previous Muse Frame workspace"
              if purpose == "migration" else "选择作品保存位置 / Choose where to save the export")
    if sys.platform == "win32":
        script = """
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
$dialog.Description = '__PROMPT__'
$owner = [System.Windows.Forms.Form]::new()
$owner.TopMost = $true
try {
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::WriteLine($dialog.SelectedPath)
    }
} finally { $dialog.Dispose(); $owner.Dispose() }
""".replace("__PROMPT__", prompt)
        executable = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        command = [str(executable), "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encoded]
        options = {"creationflags": subprocess.CREATE_NO_WINDOW}
    else:
        script = """
try
    set selectedFolder to choose folder with prompt "__PROMPT__"
    return POSIX path of selectedFolder
on error number -128
    return ""
end try
""".replace("__PROMPT__", prompt)
        command = ["/usr/bin/osascript", "-e", script]
        options = {}
    try:
        process = subprocess.run(command, capture_output=True, check=True, encoding="utf-8", timeout=180, **options)
    except subprocess.TimeoutExpired:
        raise ValueError("选择保存位置已超时，请再试一次") from None
    except (OSError, subprocess.CalledProcessError):
        raise ValueError("未能打开系统文件夹选择器 / Could not open the system folder picker") from None
    path = process.stdout.rstrip("\r\n")
    return Path(path) if path else None


def copy_to_folder(stream, folder, name):
    """Finish a temporary copy first and publish it under a new, non-overwriting name."""
    original = Path(name)
    with tempfile.NamedTemporaryFile(prefix=".muse-frame-", dir=folder, delete=False) as temporary:
        pending = Path(temporary.name)
        try:
            shutil.copyfileobj(stream, temporary)
            temporary.flush()
            os.fsync(temporary.fileno())
        except BaseException:
            temporary.close()
            pending.unlink(missing_ok=True)
            raise
    try:
        for version in range(1, 10000):
            candidate = original.name if version == 1 else f"{original.stem} ({version}){original.suffix}"
            target = folder / candidate
            try:
                try:
                    os.link(pending, target)
                except OSError as error:
                    if error.errno not in {errno.EOPNOTSUPP, errno.EXDEV, errno.EPERM}:
                        raise
                    # Removable filesystems may not implement hard links.
                    with pending.open("rb") as source, target.open("xb") as destination:
                        try:
                            shutil.copyfileobj(source, destination)
                            destination.flush()
                            os.fsync(destination.fileno())
                        except OSError:
                            destination.close()
                            target.unlink(missing_ok=True)
                            raise
            except FileExistsError:
                continue
            return candidate
        raise ValueError("同名文件过多，请换一个保存目录")
    finally:
        pending.unlink(missing_ok=True)


def save_file(handler):
    if not handler.valid_host() or handler.headers.get("Origin") != "http://" + handler.headers["Host"]:
        return handler.send({"error": "仅允许工作台同源保存"}, 403)
    if sys.platform not in {"darwin", "win32"}:
        return handler.send({"error": "这个系统使用浏览器下载 / Use browser downloads on this system"}, 501)
    if handler.headers.get_content_type() != "application/octet-stream":
        return handler.send({"error": "保存请求格式无效"}, 415)
    try:
        size = int(handler.headers.get("Content-Length", "0"))
        if not 0 < size <= MAX_EXPORT:
            return handler.send({"error": "单次保存不能超过 512 MB"}, 413)
        name = export_name(handler.headers.get("X-Muse-Export-Name"))
        if not PICKER_LOCK.acquire(blocking=False):
            return handler.send({"error": "请先完成上一个保存操作"}, 409)
        try:
            with tempfile.TemporaryFile() as data:
                handler.connection.settimeout(60)
                remaining = size
                while remaining:
                    block = handler.rfile.read(min(remaining, 1024 * 1024))
                    if not block:
                        raise ValueError("文件尚未完整传到本机，请重试")
                    data.write(block)
                    remaining -= len(block)
                folder = choose_folder()
                if folder is None:
                    return handler.send({"cancelled": True})
                data.seek(0)
                name = copy_to_folder(data, folder, name)
                return handler.send({"name": name, "folder": folder.name or "/"})
        finally:
            PICKER_LOCK.release()
    except ValueError as error:
        return handler.send({"error": str(error)}, 400)
    except OSError:
        return handler.send({"error": "无法写入这个目录，请检查权限、磁盘空间或改选本机目录"}, 500)
