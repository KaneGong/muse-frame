"""Credential-free, bounded platform result fields shared by workers and UI."""
import re,json,urllib.parse
class AgentError(ValueError):
    def __init__(self,code,message):super().__init__(message);self.code=code

def safe_platform_message(value,limit=3000):
    text=str(value)
    text=re.sub(r'(?i)Bearer\s+[^\s,;]+','Bearer [redacted]',text)
    text=re.sub(r'(?i)(token|secret|password|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+',r'\1=[redacted]',text)
    return text[:limit]

def result_metadata(value):
    if value is None:return {}
    if not isinstance(value,dict) or len(json.dumps(value))>64000:raise AgentError('E_RESULT','平台结果说明无效或过大')
    if any(x in str(k).lower().replace('_','') for k in value for x in ['token','secret','password','cookie','authorization','apikey']):raise AgentError('E_RESULT','平台结果不得包含凭据')
    result={}
    if 'result_ready' in value:
        if type(value['result_ready']) is not bool:raise AgentError('E_RESULT','result_ready必须是布尔值')
        result['result_ready']=value['result_ready']
    for key in ['source','message']:
        if value.get(key) is not None:
            if not isinstance(value[key],str):raise AgentError('E_RESULT','平台错误说明必须是文字')
            result[key]=safe_platform_message(value[key],500 if key=='source' else 3000)
    error=value.get('error')
    if error is not None:
        if isinstance(error,str):error={'message':error}
        if not isinstance(error,dict):raise AgentError('E_RESULT','平台错误说明无效')
        result['error']={k:safe_platform_message(error[k],128 if k=='code' else 3000) for k in ['code','message'] if error.get(k) is not None}
    for key in ['project_id','model','size','aspect_ratio','resolution','status']:
        if value.get(key) is not None:
            if not isinstance(value[key],str) or len(value[key])>500:raise AgentError('E_RESULT','平台结果字段无效')
            result[key]=value[key]
    for key in ['url','edit_url']:
        if value.get(key):
            url=value[key]
            if not isinstance(url,str) or len(url)>8000:raise AgentError('E_RESULT','平台链接无效')
            p=urllib.parse.urlparse(url)
            if p.scheme!='https' or not p.hostname or p.username or p.password or p.hostname in ['localhost','127.0.0.1','::1']:raise AgentError('E_RESULT','平台链接须为HTTPS来源')
            result[key]=url
    for key in ['width','height']:
        if value.get(key) is not None:
            if type(value[key]) is not int or not 1<=value[key]<=100000:raise AgentError('E_RESULT','平台原图尺寸无效')
            result[key]=value[key]
    return result
