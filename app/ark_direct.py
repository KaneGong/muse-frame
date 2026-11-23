"""Isolated Ark Seedream 5.5 adapter. Synchronous API, durable local receipts, no resend."""
import base64
import hashlib
import http.client
import io
import json
import os
import re
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
import urllib.parse
from ark_keychain import ArkKeychain
from ark_models import SPECS, schema, item, documented_catalog
from pathlib import Path
from PIL import Image

MODEL = 'doubao-seedream-5-5-261028'
ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3'
SIZE = '1776x2368'
DEFINITIVE_REJECTIONS = {400, 401, 403, 404, 413, 422, 429}
FORMAT_MODELS = ('doubao-seedream-5-5-', 'doubao-seedream-5-0-')
GROUP_MODELS = ('doubao-seedream-5-0-260128', 'doubao-seedream-5-0-lite-260128',
                'doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828')
ERROR_HINTS = {
    400: '方舟拒绝了请求。检查参数、参考图和内容审核提示。',
    401: '方舟鉴权失败。检查 API Key 是否有效及是否属于当前调用方式。',
    403: '方舟拒绝访问。检查 Key 权限、模型用量和账户状态。',
    404: '方舟找不到模型或接入点，或当前 Key 无权访问。请核对模型开通和 Key 授权。',
    413: '方舟拒绝了请求体大小。请减少参考图体积后再提交。',
    422: '方舟无法处理请求参数。请检查模型设置与参考图。',
    429: '方舟触发请求限流。请核对配额并降低提交频率。',
}

PROVIDER_HINTS = {
    'InputImageSensitiveContentDetected': '输入图片未通过方舟审核。请检查本次参考图或修图原图。方舟未返回具体图片编号。',
    'InputImageRiskDetection': '输入图片未通过方舟审核。请检查本次参考图或修图原图。方舟未返回具体图片编号。',
    'OutputImageSensitiveContentDetected': '生成图片未通过方舟审核，本次没有可保存的图片。请检查参考图与拍摄或修图要求。',
    'OutputImageRiskDetection': '生成图片未通过方舟审核，本次没有可保存的图片。请检查参考图与拍摄或修图要求。',
    'InputTextSensitiveContentDetected': '输入文字未通过方舟审核。请检查本次提示词。',
    'SensitiveContentDetected': '输入文字未通过方舟审核。请检查本次提示词。',
    'ModelNotOpen': '当前方舟账号或项目尚未开通该模型。请核对模型开通状态。',
    'AccessDenied': '当前方舟 API Key 无权调用该模型或接入点。请核对 Key 的授权范围。',
    'AuthenticationError': ERROR_HINTS[401],
    'MissingParameter': '方舟提示请求缺少必填参数。请查看请求详情并核对生成设置。',
    'InvalidParameter': '方舟未接受本次参数。请查看请求详情，核对模型、尺寸或参考图设置。',
}


def receipt_rejection(receipt):
    code = (receipt.get('provider_code') or '').split('.')
    if receipt.get('provider_code') in PROVIDER_HINTS:
        return PROVIDER_HINTS[receipt['provider_code']]
    if code[0] in PROVIDER_HINTS:
        return PROVIDER_HINTS[code[0]]
    if receipt.get('provider_code') == 'OperationDenied.PermissionDenied':
        return PROVIDER_HINTS['AccessDenied']
    return ERROR_HINTS.get(receipt.get('http'))


def has_image_receipt(receipt):
    from platforms import allow_image_url
    return (receipt.get('status') == 'completed' and any(
        isinstance(artifact, dict) and allow_image_url(artifact.get('url'))
        for artifact in (receipt.get('artifacts') or [])))


def safe_identifier(value):
    if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value):
        return value
    return None


def provider_fields(value):
    # Persist structured codes only. Gateway messages can include submitted data.
    error = value.get('error') if isinstance(value, dict) else None
    if not isinstance(error, dict):
        return {}
    return {label: identifier for label, field in (
        ('provider_code', 'code'), ('provider_param', 'param')
    ) if (identifier := safe_identifier(error.get(field)))}


def network_failure(error, response_started):
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    if not response_started and isinstance(reason, (socket.gaierror, ConnectionRefusedError, ssl.SSLCertVerificationError)):
        return 'failed', 'connect', '连接建立失败，本次没有发送生成请求。'
    if isinstance(reason, TimeoutError):
        return 'needs_review', 'response_body' if response_started else 'request_or_headers', '等待方舟响应超时。'
    if isinstance(reason, (BrokenPipeError, ConnectionResetError, http.client.RemoteDisconnected, http.client.IncompleteRead)):
        return 'needs_review', 'response_body' if response_started else 'request_or_headers', '连接在写入请求或接收响应时中断。' if not response_started else '方舟响应正文未接收完整。'
    return 'needs_review', 'response_body' if response_started else 'request_or_headers', '未取得完整方舟响应。'



def packed(value):
    return {'structuredContent': value, 'content': []}


class ArkPreparationError(ValueError):
    pass


class ArkDirect:
    tools = {'list_models': {}, 'describe_model': {}, 'generate_image': {}, 'edit_image': {},
             'get_task': {}, 'get_task_status': {}}

    def __init__(self, root):
        self.root = Path(root) / 'ark-receipts'
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._key = ''
        self._storage = 'session'
        self._keychain = ArkKeychain(root) if sys.platform == 'darwin' else None
        self._credential_lock = threading.Lock()
        self._lock = threading.RLock()

    def close(self):
        pass

    def credential_state(self):
        return {'configured': bool(self._key), 'storage': self._storage,
                'can_remember': self._keychain is not None}

    @staticmethod
    def _valid_key(value):
        return (isinstance(value, str) and 20 <= len(value) <= 512
                and value.isascii() and value.isprintable() and not re.search(r'\s', value))

    def configure(self, data):
        value = data.get('api_key')
        value = value.strip() if isinstance(value, str) else ''
        clear = data.get('clear') is True
        remember = data.get('remember') is True
        if not clear and not self._valid_key(value):
            raise ValueError('请输入有效的方舟 API Key')
        with self._credential_lock:
            if clear or not remember:
                if self._keychain is not None:
                    self._keychain.forget()
                self._storage = 'session'
                self._key = '' if clear else value
            else:
                if self._keychain is None:
                    raise ValueError('当前系统只支持在本次运行中使用方舟 Key')
                self._keychain.save(value)
                self._storage = 'keychain'
                self._key = value
            return self.credential_state()

    def _catalog_key(self):
        with self._credential_lock:
            if not self._key and self._keychain is not None:
                value = self._keychain.read()
                if value:
                    if not self._valid_key(value):
                        raise ValueError('钥匙串中的方舟 Key 无效。请重新输入。')
                    self._key = value
                    self._storage = 'keychain'
            if not self._key:
                raise ValueError('请在绘图平台输入方舟 API Key 并连接。')
            return self._key

    def reference(self, path):
        raw = Path(path).read_bytes()
        if len(raw) > 10 * 1024 * 1024:
            raise ValueError('方舟测试版参考图请小于10MB')
        with Image.open(io.BytesIO(raw)) as image:
            mime = Image.MIME.get(image.format)
            width, height = image.size
            if (min(width, height) <= 14 or width * height > 36_000_000
                    or max(width, height) > min(width, height) * 16):
                raise ValueError('方舟参考图需宽高均大于 14 像素、总像素不超过 3600 万，宽高比在 1:16 到 16:1 之间')
            image.verify()
        if mime not in ('image/png', 'image/jpeg', 'image/webp'):
            raise ValueError('方舟参考图请使用 PNG、JPEG 或 WebP')
        return 'data:' + mime + ';base64,' + base64.b64encode(raw).decode()

    def prepare_submission(self, job_id, prompt):
        self._path(job_id)
        return {'submission_key': job_id, 'project_id': 'ark-local'}

    def _path(self, task):
        if not isinstance(task, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,99}', task):
            raise ValueError('方舟本地回执编号无效')
        return self.root / (task + '.json')

    def _save(self, task, value):
        path = self._path(task)
        temp = path.with_suffix('.tmp')
        with temp.open('w') as stream:
            os.chmod(temp, 0o600)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)

    def _read(self, task):
        try:
            receipt = json.loads(self._path(task).read_text())
            if isinstance(receipt, dict):
                return receipt
        except FileNotFoundError:
            return {'status': 'needs_review', 'error': '没有已保存的方舟回执；不会重新生成。'}
        except (OSError, ValueError):
            pass
        return {'status': 'needs_review', 'error': '本地方舟回执无法读取，已保留记录。'}

    def call(self, name, args):
        if name == 'list_models':
            return packed(self._catalog(self._catalog_key()))
        if name == 'describe_model':
            return packed({'schema': schema(args.get('model'))})
        if name in ('get_task', 'get_task_status'):
            tasks = args.get('task_ids') or []
            if len(tasks) != 1:
                raise ValueError('一次读取一条方舟回执')
            return packed(self._read(tasks[0]))
        if name not in ('generate_image', 'edit_image'):
            raise ValueError('方舟测试版不支持此操作')
        with self._lock:
            return self._generate(args)

    def _catalog(self, key):
        models=[];seen=set();after=None
        try:
            for page in range(30):
                query='?limit=100'+('&after='+urllib.parse.quote(after,safe='') if after else '')
                request=urllib.request.Request(ENDPOINT+'/models'+query,
                    headers={'Authorization':'Bearer '+key,'Accept':'application/json'})
                with urllib.request.urlopen(request,timeout=20) as response:
                    result=json.load(response)
                entries=result.get('data',result.get('models'))
                if not isinstance(entries,list):
                    raise ValueError('invalid model catalog')
                for entry in entries:
                    if not isinstance(entry,dict):continue
                    model=entry.get('id') or entry.get('name')
                    if not isinstance(model,str) or not re.fullmatch(r'[A-Za-z0-9._/-]{1,160}',model):continue
                    modalities=entry.get('output_modalities') or []
                    if model not in seen and ('seedream' in model or 'seededit' in model or 'image' in modalities):
                        seen.add(model);models.append(item(model))
                if not result.get('has_more'):break
                cursor=result.get('last_id') or (entries[-1].get('id') if entries else None)
                if not cursor or cursor==after:raise ValueError('invalid pagination')
                after=cursor
            else:raise ValueError('catalog pagination limit')
            if not models:raise ValueError('empty image catalog')
            return {'models':models,'message':f'API 返回 {len(models)} 个图片模型；参数按官方规格适配，调用权限以实际提交为准。'}
        except urllib.error.HTTPError as error:
            code=error.code;error.close()
            if code==401:raise ValueError('方舟拒绝此 Key（HTTP 401），请检查后重新连接') from None
            reason=f'目录接口 HTTP {code}'
        except (OSError,ValueError,TypeError):
            reason='目录接口未返回完整有效图片模型列表'
        return {'models':documented_catalog(),'message':reason+'；当前显示官方文档适配目录，并非账号已授权列表。参数来自官方规格。'}

    def _generate(self, args):
        key = self._key
        if not key:
            raise ArkPreparationError('方舟 API Key 尚未配置；本次未提交')
        model = args.get('model')
        if model not in SPECS or args.get('n', 1) != 1:
            raise ArkPreparationError('请选择已适配的图片模型；每个任务生成一张图片')
        refs = args.get('images', args.get('ref_images', []))
        if not isinstance(refs, list) or len(refs) > SPECS[model][2] or any(not isinstance(r,str) or not r.startswith('data:image/') for r in refs):
            raise ArkPreparationError('方舟参考图无效或数量超出模型限制')
        params = args.get('params') or {}
        sizes = schema(model)['properties']['size']['enum']
        size = params.get('size') or (SIZE if SIZE in sizes else '2048x2048')
        if size not in sizes or set(params) - {'size'}:
            raise ArkPreparationError('所选模型不支持这个输出尺寸，请重新选择')
        task = (args.get('receipt') or {}).get('submission_key')
        path = self._path(task)
        if path.exists():
            return packed(self._read(task))
        prompt = args.get('prompt')
        if not isinstance(prompt, str) or not prompt.strip():
            raise ArkPreparationError('提示词不能为空')
        body = {'model': model, 'prompt': prompt, 'size': size,
                'response_format': 'url', 'watermark': False}
        if model.startswith(FORMAT_MODELS):
            body['output_format'] = 'png'
        if model in GROUP_MODELS:
            body['sequential_image_generation'] = 'disabled'
        if refs:
            body['image'] = refs
        payload = json.dumps(body, ensure_ascii=False).encode()
        started = time.monotonic()
        record = {'status': 'needs_review', 'task_ids': [task], 'project_id': 'ark-local',
                  'submission_key': task, 'model': model, 'started_at': time.time(),
                  'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
                  'reference_count': len(refs), 'size': size, 'request_bytes': len(payload),
                  'client_request_id': task, 'phase': 'request_or_headers',
                  'error': '方舟请求尚未取得完整回执；请核对费用，不会自动重投。'}
        self._save(task, record)
        request = urllib.request.Request(ENDPOINT + '/images/generations',
            data=payload, headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                                   'X-Client-Request-Id': task}, method='POST')
        response_started = False
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                response_started = True
                record.update(http=getattr(response, 'status', 200), phase='response_body',
                              request_id=safe_identifier(response.headers.get('x-request-id') or response.headers.get('x-tt-logid')))
                if key in (record['request_id'] or ''):
                    record['request_id'] = None
                self._save(task, record)
                result = json.load(response)
            self._read_generation_result(record, result)
        except urllib.error.HTTPError as error:
            with error:
                request_id = error.headers and (error.headers.get('x-request-id') or error.headers.get('x-tt-logid'))
                record.update(status='failed' if error.code in DEFINITIVE_REJECTIONS else 'needs_review',
                              http=error.code, phase='http_error', request_id=safe_identifier(request_id),
                              error=ERROR_HINTS.get(error.code, '方舟返回服务异常，生成结果待核对。'))
                try:
                    record.update(provider_fields(json.loads(error.read(16 * 1024))))
                except (OSError, ValueError, http.client.HTTPException):
                    pass
        except (OSError, http.client.HTTPException) as error:
            status, phase, message = network_failure(error, response_started)
            reason = error.reason if isinstance(error, urllib.error.URLError) else error
            record.update(status=status, phase=phase, error=message,
                          transport_error=type(reason).__name__, errno=getattr(reason, 'errno', None))
        except (ValueError, TypeError):
            record.update(phase='invalid_response', error='方舟响应无法解析，生成结果待核对。')
        record['elapsed_seconds'] = round(time.monotonic() - started, 3)
        for field in ('request_id', 'provider_code', 'provider_param', 'returned_model'):
            if key in (record.get(field) or ''):
                record.pop(field, None)
        if record['status'] == 'failed':
            record['error'] = receipt_rejection(record) or record['error']
        self._save(task, record)
        return packed(record)

    def _read_generation_result(self, record, result):
        from platforms import allow_image_url
        if not isinstance(result, dict):
            raise ValueError('unexpected Ark response')
        items = result.get('data')
        if not isinstance(items, list):
            items = []
        artifacts = [{'url': item['url']} for item in items
                     if isinstance(item, dict) and allow_image_url(item.get('url'))]
        usage = result.get('usage')
        if isinstance(usage, dict):
            record['usage'] = {key: value for key, value in usage.items()
                               if key in ('generated_images', 'input_images', 'output_tokens', 'total_tokens')
                               and type(value) is int}
        record.update(returned_model=safe_identifier(result.get('model')), artifacts=artifacts)
        if artifacts:
            record.update(status='completed', phase='image_received', error=None)
            return
        rejection = provider_fields(result)
        for item in items:
            if rejection:
                break
            rejection = provider_fields(item)
        if rejection.get('provider_code'):
            record.update(rejection, status='failed', phase='provider_rejection',
                          error='方舟已返回生成错误，详情见平台错误码。')
        else:
            record.update(phase='no_image', error='方舟响应中没有可保存的图片地址，生成结果待核对。')
