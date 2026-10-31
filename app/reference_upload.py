"""Workbench-owned platform upload copies; original assets are never overwritten."""
import base64,hashlib,io,os,uuid
from pathlib import Path
from PIL import Image,ImageOps

DEFAULT_BASE64_LIMIT=3_700_000

def encoded_size(n):return 4*((n+2)//3)

def upload_prefix(asset_id):return 'reference-upload-'+hashlib.sha256(asset_id.encode()).hexdigest()+'-'

def prepare_upload(root,asset_id,source,max_base64_chars=DEFAULT_BASE64_LIMIT):
    if type(max_base64_chars) is not int or not 4096<=max_base64_chars<=32_000_000:
        raise ValueError('平台base64上限须为4096至32000000之间的整数')
    source=Path(source);raw=source.read_bytes();source_digest=hashlib.sha256(raw).hexdigest()
    with Image.open(io.BytesIO(raw)) as im:
        im.load();original_size=list(im.size);fmt=im.format
        if fmt not in ['PNG','JPEG','WEBP']:raise ValueError('参考图格式不支持')
        if encoded_size(len(raw))<=max_base64_chars:
            return {'base64':base64.b64encode(raw).decode(),'local_path':str(source),'sha256':source_digest,
                'upload':{'prepared':False,'format':fmt,'source_sha256':source_digest,'source_bytes':len(raw),'bytes':len(raw),'base64_chars':encoded_size(len(raw)),'max_base64_chars':max_base64_chars,'original_dimensions':original_size,'dimensions':original_size}}
        image=ImageOps.exif_transpose(im)
        alpha='A' in image.getbands() or 'transparency' in image.info
        image=image.convert('RGBA' if alpha else 'RGB')
        icc=im.info.get('icc_profile');icc_args={'icc_profile':icc} if icc else {}
    # Preserve pixel dimensions first. Transparent artwork stays PNG, never flattened.
    quality=None;output=None;outfmt='PNG' if alpha else 'JPEG'
    while True:
        qualities=[None] if alpha else [95,92,88,84]
        for quality in qualities:
            buf=io.BytesIO()
            if alpha:image.save(buf,format='PNG',optimize=True,**icc_args)
            else:image.save(buf,format='JPEG',quality=quality,subsampling=0,optimize=False,**icc_args)
            output=buf.getvalue()
            if encoded_size(len(output))<=max_base64_chars:break
        if encoded_size(len(output))<=max_base64_chars:break
        w,h=image.size
        if min(w,h)<=16:raise ValueError('无法生成满足平台限制的上传件，原图已保留')
        image=image.resize((max(1,int(w*.8)),max(1,int(h*.8))),Image.Resampling.LANCZOS)
    folder=Path(root)/'previews';folder.mkdir(parents=True,exist_ok=True)
    suffix='.png' if alpha else '.jpg'
    path=folder/(upload_prefix(asset_id)+source_digest+'-'+str(max_base64_chars)+suffix)
    temp=folder/(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:temp.write_bytes(output);os.replace(temp,path)
    finally:temp.unlink(missing_ok=True)
    return {'base64':base64.b64encode(output).decode(),'local_path':str(path.resolve()),'sha256':hashlib.sha256(output).hexdigest(),
        'upload':{'prepared':True,'format':outfmt,'source_sha256':source_digest,'source_bytes':len(raw),'bytes':len(output),'base64_chars':encoded_size(len(output)),'max_base64_chars':max_base64_chars,'original_dimensions':original_size,'dimensions':list(image.size),'quality':quality}}
