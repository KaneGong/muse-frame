"""Validate versioned reference intent without imposing a prose language."""
import copy,hashlib,json,re

ROLES=('face','body','outfit','scene','pose')
OPTIONAL_BODY_COMPILER='beta-portrait-refs-v3'
def validate_prompt_contract(payload,bindings):
    contract=payload.get('prompt_contract')
    if contract is None:return None
    if not isinstance(contract,dict) or type(contract.get('version')) is not int or contract['version']!=2:
        raise ValueError('不支持的提示词结构版本，请使用兼容版本打开')
    if contract.get('compiler') not in ('shot-spec-v2.1','shot-spec-v2.2','shot-spec-v2.3','shot-spec-v2.4','shot-spec-v2.5','shot-spec-v2.6','shot-spec-v2.7','beta-five-refs-v1','beta-five-refs-v2',OPTIONAL_BODY_COMPILER) or contract.get('mode') not in ('guided','manual'):
        raise ValueError('不支持的提示词编译版本或模式')
    if payload.get('mode')!='generate' or payload.get('resultRole')!='output':
        raise ValueError('提示词结构仅用于最终作品任务')
    if not isinstance(contract.get('shot_id'),str) or not 1<=len(contract['shot_id'])<=100:
        raise ValueError('镜头标识无效')
    if len(json.dumps(contract,ensure_ascii=False))>128*1024:raise ValueError('拍摄要求快照过大')
    actual={r:bindings.get(r) or '' for r in ROLES}
    if contract.get('reference_roles')!=actual:raise ValueError('参考图绑定与拍摄要求快照不一致')
    snapshot=contract.get('snapshot')
    if not isinstance(snapshot,dict) or snapshot.get('mode')!=contract['mode'] or not isinstance(snapshot.get('fields'),dict):
        raise ValueError('拍摄要求快照无效')
    pose=snapshot.get('pose')
    if not isinstance(pose,dict) or pose.get('source') not in ('reference','text','free'):
        raise ValueError('姿态来源快照无效')
    expected_pose=pose.get('assetId','') if pose['source']=='reference' else ''
    if expected_pose!=actual['pose']:raise ValueError('姿态图片绑定与拍摄要求快照不一致')
    result=copy.deepcopy(contract)
    result['prompt_sha256']=hashlib.sha256(payload['prompt'].encode('utf-8')).hexdigest()
    return result

def referenced_numbers(prompt):
    """Only explicit numbered image references; this is not semantic analysis."""
    return [int(n) for n in re.findall(r'(?:图\s*|(?i:image)\s*)(\d+)',prompt)]
