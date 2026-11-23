"""Ark image capabilities. Source: official image-generation-api, checked 2026-11-13.
Model-list availability is not generation permission. Parameters are documented,
not falsely described as introspected JSON schema returned by /models.
"""
import math

DOC = 'https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh'
# Preserve exact model IDs, including the 5.0 lite historical alias.
SPECS = {
 'doubao-seedream-5-5-261028': ('Seedream 5.5', (1024,1536,2048),10),
 'doubao-seedream-5-0-pro-260628': ('Seedream 5.0 Pro',(1024,1536,2048),10),
 'doubao-seedream-5-0-flash-260915': ('Seedream 5.0 Flash',(1024,1536,2048),10),
 'doubao-seedream-5-0-260128': ('Seedream 5.0 Lite',(2048,3072,4096),14),
 'doubao-seedream-5-0-lite-260128': ('Seedream 5.0 Lite',(2048,3072,4096),14),
 'doubao-seedream-4-5-251128': ('Seedream 4.5 · 旧模型',(2048,4096),14),
 'doubao-seedream-4-0-20260415': ('Seedream 4.0',(1024,2048,4096),14),
 'doubao-seedream-4-0-250828': ('Seedream 4.0 · 旧模型',(1024,2048,4096),14),
}
RATIOS = ((1,1),(3,4),(4,3),(2,3),(3,2),(9,16),(16,9),(9,21),(21,9))


def schema(model):
    if model not in SPECS:
        raise ValueError('目录中发现此图片模型，但尚无可核验的参数适配；请选用已适配的 Seedream 模型')
    name, levels, _ = SPECS[model]
    sizes=[];labels={}
    for level in levels:
        for w,h in RATIOS:
            # Exact integer ratios, bounded pixel area. This uses the documented
            # explicit WxH path rather than pretending tiers are aspect ratios.
            k=max(1,int(level/math.sqrt(w*h)))
            size=f'{w*k}x{h*k}'
            sizes.append(size);labels[size]=f'{level/1024:g}K · {w*k} × {h*k}'
    if model.startswith(('doubao-seedream-5-5-','doubao-seedream-5-0-pro-','doubao-seedream-5-0-flash-')):
        sizes.append('1776x2368');labels['1776x2368']='2K · 1776 × 2368（原测试尺寸）'
    return {'type':'object','properties':{'size':{'type':'string','enum':sizes}},
            'x-size-labels':labels,'x-source':DOC,'x-verified-date':'2026-11-13'}


def item(model, source='api'):
    spec=SPECS.get(model)
    return {'name':model,'display_name':spec[0] if spec else model+' · 参数待适配',
            'vendor':'火山方舟','max_references':spec[2] if spec else 0,
            'capabilities':['generate','references','edit'] if spec else [],
            'catalog_source':source,'parameters_source':'official-docs' if spec else 'unverified',
            'permission':'unverified'}


def documented_catalog():
    return [item(model,'documented-fallback') for model in SPECS if model!='doubao-seedream-5-0-lite-260128']
