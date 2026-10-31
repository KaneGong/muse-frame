"""Standalone vision transport: a multimodal model reads the pose image.

Replaces the Codex CLI image call for the standalone edition. Any
OpenAI-compatible endpoint works (SiliconFlow, GLM, OpenRouter, vLLM, ...),
so the workbench needs a vision model, not an Agent session.

Configuration, first match wins:
  1. environment: VISION_BASE_URL, VISION_MODEL, VISION_API_KEY
  2. <data>/vision.json: {"base_url","model","api_key_env","api_key_file","api_key"}
  3. error E_VISION_NOT_CONFIGURED with an actionable message

The key is never logged and never returned to the client.
"""
import base64
import io
import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = 'ai-portrait-studio-standalone/1.0'
TIMEOUT = float(os.environ.get('VISION_TIMEOUT', '240'))
# Hard wall-clock ceiling for one recognition call (seconds).
DEADLINE = float(os.environ.get('VISION_DEADLINE', '300'))
MAX_EDGE = 1024


def load_config(data_root=None):
    base_url = os.environ.get('VISION_BASE_URL')
    model = os.environ.get('VISION_MODEL')
    key = os.environ.get('VISION_API_KEY')
    if base_url and model and key:
        return {'base_url': base_url.rstrip('/'), 'model': model, 'api_key': key,
                'detail': os.environ.get('VISION_DETAIL') or 'standard'}
    config = {}
    if data_root:
        path = Path(data_root) / 'vision.json'
        if path.is_file():
            try:
                config = json.loads(path.read_text())
            except (OSError, ValueError):
                config = {}
    base_url = base_url or config.get('base_url')
    model = model or config.get('model')
    key = key or config.get('api_key')
    if not key and config.get('api_key_env'):
        key = os.environ.get(config['api_key_env'])
    if not key and config.get('api_key_file'):
        key_path = Path(config['api_key_file'])
        if not key_path.is_absolute() and data_root:
            key_path = Path(data_root) / key_path
        try:
            key = key_path.read_text().strip()
        except OSError:
            key = None
    if not (base_url and model and key):
        raise RuntimeError('E_VISION_NOT_CONFIGURED: 尚未配置多模态模型。'
                           '请在数据目录放 vision.json（base_url、model、api_key 或 api_key_env），'
                           '或设置 VISION_BASE_URL / VISION_MODEL / VISION_API_KEY')
    detail = os.environ.get('VISION_DETAIL') or config.get('detail') or 'standard'
    if detail not in ('standard', 'detailed'):
        detail = 'standard'
    return {'base_url': base_url.rstrip('/'), 'model': model, 'api_key': key, 'detail': detail}


def _prepare_image(path, max_edge=MAX_EDGE):
    """Downscale to keep the request inside provider limits and token budgets."""
    raw = Path(path).read_bytes()
    try:
        from PIL import Image
        image = Image.open(io.BytesIO(raw))
        image.load()
        if image.mode not in ('RGB', 'L'):
            image = image.convert('RGB')
        longest = max(image.width, image.height)
        if longest > max_edge:
            scale = max_edge / float(longest)
            image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                                 Image.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG', quality=92)
        return buffer.getvalue(), 'image/jpeg'
    except ImportError:
        suffix = Path(path).suffix.lower()
        mime = {'png': 'image/png', 'webp': 'image/webp'}.get(suffix.lstrip('.'), 'image/jpeg')
        return raw, mime


def transcribe(path, instruction, data_root=None, config=None):
    config = config or load_config(data_root)
    image_bytes, mime = _prepare_image(path)
    data_url = 'data:%s;base64,%s' % (mime, base64.b64encode(image_bytes).decode())
    payload = {
        'model': config['model'],
        'temperature': 0.2,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'image_url', 'image_url': {'url': data_url}},
                {'type': 'text', 'text': instruction},
            ],
        }],
    }
    request = urllib.request.Request(
        config['base_url'] + '/chat/completions',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + config['api_key'],
                 'User-Agent': UA},
        method='POST')
    started = time.time()
    # A socket timeout bounds each read, not the whole request: a model that
    # trickles thinking tokens can hold a call open for ten minutes. Enforce a
    # hard wall-clock deadline around the call instead.
    outcome = {}

    def work():
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                outcome['body'] = json.load(response)
        except Exception as exc:
            outcome['error'] = exc

    worker = threading.Thread(target=work, daemon=True)
    worker.start()
    worker.join(DEADLINE)
    if worker.is_alive():
        raise RuntimeError('E_VISION_TIMEOUT：视觉模型 %.0f 秒未返回，已放弃本次识别；'
                           '可在“连接与模型”里换一个更快的模型' % DEADLINE)
    error = outcome.get('error')
    if isinstance(error, urllib.error.HTTPError):
        detail = error.read().decode('utf-8', 'replace')[:300]
        raise RuntimeError('E_VISION_HTTP %d：%s' % (error.code, detail)) from None
    if isinstance(error, OSError):
        raise RuntimeError('E_VISION_CONNECTION：视觉模型连接失败（%s）' % error.__class__.__name__) from None
    if error is not None:
        raise RuntimeError('E_VISION_CONNECTION：视觉模型调用失败（%s）' % error.__class__.__name__) from None
    body = outcome.get('body') or {}
    try:
        text = body['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError):
        raise RuntimeError('E_VISION_FORMAT：视觉模型未返回可读内容') from None
    if isinstance(text, list):
        text = ''.join(part.get('text', '') for part in text if isinstance(part, dict))
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError('E_VISION_EMPTY：视觉模型返回空内容')
    return {'text': text.strip(), 'model': config['model'],
            'elapsed': round(time.time() - started, 1)}


def describe(data_root=None):
    """Diagnostics without secrets: what is configured, not the key itself."""
    try:
        config = load_config(data_root)
    except RuntimeError as err:
        return {'configured': False, 'error': str(err).split(':')[0]}
    return {'configured': True, 'base_url': config['base_url'], 'model': config['model'],
            'detail': config.get('detail') or 'standard'}


if __name__ == '__main__':
    import sys
    root = sys.argv[1] if len(sys.argv) > 1 else None
    print(json.dumps(describe(root), ensure_ascii=False, indent=2))


def probe(data_root=None):
    """Cheapest possible credential check: one short text completion."""
    config = load_config(data_root)
    payload = {'model': config['model'], 'max_tokens': 16,
               'messages': [{'role': 'user', 'content': '只回复两个字：可用'}]}
    request = urllib.request.Request(
        config['base_url'] + '/chat/completions',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + config['api_key'],
                 'User-Agent': UA},
        method='POST')
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.load(response)
    except urllib.error.HTTPError as err:
        detail = err.read().decode('utf-8', 'replace')[:200]
        raise RuntimeError('E_VISION_HTTP %d：%s' % (err.code, detail)) from None
    except OSError as err:
        raise RuntimeError('E_VISION_CONNECTION：连接失败（%s）' % err.__class__.__name__) from None
    try:
        reply = body['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError):
        raise RuntimeError('E_VISION_FORMAT：返回内容无法识别') from None
    if isinstance(reply, list):
        reply = ''.join(p.get('text', '') for p in reply if isinstance(p, dict))
    return {'ok': True, 'model': config['model'], 'reply': (reply or '')[:40],
            'elapsed': round(time.time() - started, 1)}
