"""Translate visible output choices to the model's advertised native fields."""
import math,re

def size_ratio(value):
    m=re.fullmatch(r'(\d+)[*x×](\d+)',value or '')
    if not m:return 'default'
    w,h=map(int,m.groups());g=math.gcd(w,h);return f'{w//g}:{h//g}'

def normalize_options(schema,payload):
    p=dict(payload);props=schema.get('properties',{});ratio=p.get('aspect_ratio','default');resolution=p.get('resolution','default');sizes=props.get('size',{}).get('enum',[])
    native_ratio=props.get('aspect_ratio',{}).get('enum',[]);native_resolution=props.get('resolution',{}).get('enum',[])
    use_size=bool(sizes) and (bool(p.get('size')) or not (native_ratio and native_resolution))
    if use_size:
        size=p.get('size')
        if not size:
            choices=[s for s in sizes if s!='auto' and (ratio=='default' or size_ratio(s)==ratio)]
            if ratio=='default' and 'auto' in sizes:size='auto'
            elif choices:
                target={'1K':1024,'2K':2048,'4K':3840}.get(resolution,2048)
                size=min(choices,key=lambda s:abs(max(map(int,re.split(r'[*x×]',s)))-target))
            else:raise ValueError('当前模型没有这个画幅的输出尺寸，请重新选择模型参数')
        if size not in sizes:raise ValueError('当前模型不支持这个输出尺寸')
        actual=size_ratio(size)
        if ratio!='default' and actual!='default' and actual!=ratio:raise ValueError('输出尺寸与画幅不一致，请重新选择')
        p.update(size=size,resolution='default',aspect_ratio=actual if actual!='default' else ratio)
    else:
        p.pop('size',None)
        if 'resolution' not in props:p['resolution']='default'
        elif resolution!='default' and props['resolution'].get('enum') and resolution not in props['resolution']['enum']:raise ValueError('当前模型不支持该分辨率')
        # Pixel resolutions already define both dimensions. Ideogram 3 explicitly
        # forbids combining resolution with aspect_ratio; the latter's enum may
        # still be advertised as an alternative input. Do not send both.
        pixel_resolution=bool(native_resolution) and all(size_ratio(v)!='default' for v in native_resolution)
        if not pixel_resolution and 'aspect_ratio' in props and ratio!='default' and native_ratio and ratio not in native_ratio:raise ValueError('当前模型不支持该画幅')
        if pixel_resolution or 'aspect_ratio' not in props:
            actual=size_ratio(resolution)
            if ratio!='default' and actual!='default' and ratio!=actual:raise ValueError('输出尺寸与画幅不一致，请重新选择')
            p['aspect_ratio']='default'
    return p

def native_params(schema,payload):
    p=normalize_options(schema,payload);props=schema.get('properties',{});params={}
    if p.get('size'):params['size']=p['size']
    if 'resolution' in props and p.get('resolution','default')!='default':params['resolution']=p['resolution']
    if payload.get('mode')=='edit' and 'aspect_ratio' in props and p.get('aspect_ratio','default')!='default':params['aspect_ratio']=p['aspect_ratio']
    return p,params

def parameter_rejection(message):
    return 'Lovart 返回错误' in message and bool(re.search(r'unknown param ["\']',message))
