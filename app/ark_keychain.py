"""Workspace-scoped Ark credentials in the macOS default keychain."""

from contextlib import contextmanager
import ctypes as c
from hashlib import sha256
from pathlib import Path

SERVICE = b'Muse Frame - Ark API Key'
NOT_FOUND = -25300
DUPLICATE = -25299

_pointer = c.c_void_p
_ref = c.POINTER(_pointer)
_size = c.c_uint32


class ArkKeychain:
    def __init__(self, root):
        self.account = sha256(str(Path(root).resolve()).encode()).hexdigest().encode('ascii')

    @contextmanager
    def _keychain(self):
        try:
            security = c.CDLL('/System/Library/Frameworks/Security.framework/Security')
            core = c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
        except OSError:
            raise ValueError('无法打开 macOS 钥匙串。请确认钥匙串可用后重试。') from None
        core.CFRelease.argtypes = [_pointer]
        core.CFRelease.restype = None
        name_args = [_pointer, _size, c.c_char_p, _size, c.c_char_p]
        for name, types in (
            ('SecKeychainCopyDefault', [_ref]),
            ('SecKeychainFindGenericPassword', name_args + [c.POINTER(_size), _ref, _ref]),
            ('SecKeychainAddGenericPassword', name_args + [_size, c.c_char_p, _ref]),
            ('SecKeychainItemFreeContent', [_pointer, _pointer]),
            ('SecKeychainItemModifyAttributesAndData', [_pointer, _pointer, _size, c.c_char_p]),
            ('SecKeychainItemDelete', [_pointer]),
        ):
            function = getattr(security, name)
            function.argtypes = types
            function.restype = c.c_int32
        keychain = _pointer()
        self._check(security.SecKeychainCopyDefault(c.byref(keychain)))
        try:
            yield security, core, (keychain, len(SERVICE), SERVICE, len(self.account), self.account)
        finally:
            core.CFRelease(keychain)

    @staticmethod
    def _check(status):
        if status:
            raise ValueError(f'无法访问 macOS 钥匙串（{status}）。请解锁钥匙串并允许访问后重试。')

    def read(self):
        with self._keychain() as (security, _, name):
            size = _size()
            data = _pointer()
            status = security.SecKeychainFindGenericPassword(*name, c.byref(size), c.byref(data), None)
            if status == NOT_FOUND:
                return ''
            self._check(status)
            try:
                return c.string_at(data, size.value).decode('utf-8')
            except UnicodeError:
                raise ValueError('钥匙串中的方舟 Key 无效。请重新输入。') from None
            finally:
                security.SecKeychainItemFreeContent(None, data)

    def save(self, value):
        data = value.encode('utf-8')
        with self._keychain() as (security, core, name):
            status = security.SecKeychainAddGenericPassword(*name, len(data), data, None)
            if status != DUPLICATE:
                self._check(status)
                return
            item = _pointer()
            self._check(security.SecKeychainFindGenericPassword(*name, None, None, c.byref(item)))
            try:
                self._check(security.SecKeychainItemModifyAttributesAndData(item, None, len(data), data))
            finally:
                core.CFRelease(item)

    def forget(self):
        with self._keychain() as (security, core, name):
            item = _pointer()
            status = security.SecKeychainFindGenericPassword(*name, None, None, c.byref(item))
            if status == NOT_FOUND:
                return
            self._check(status)
            try:
                self._check(security.SecKeychainItemDelete(item))
            finally:
                core.CFRelease(item)
