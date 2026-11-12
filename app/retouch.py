"""Local non-destructive photo adjustment, with bounded proxy caching for interaction."""
import base64,io,math,time,uuid,threading,json,hashlib
from collections import OrderedDict
from PIL import Image,ImageOps,ImageEnhance,ImageCms,ImageFilter,ImageChops
from media_paths import media_url,resolved_workspace_path

RENDER_LOCK=threading.Lock()
LEGACY_LIMITS={'exposure':(-2,2),'contrast':(-50,50),'warmth':(-50,50),'saturation':(-50,50)}
LIMITS={**LEGACY_LIMITS,**{k:(-50,50) for k in ['highlights','shadows','whites','blacks','clarity','texture']}}
OPTIONAL_LIMITS={'tint':(-100,100),'sharpness':(0,100)}
PROXIES=OrderedDict()
MASTERS=OrderedDict()

def settings(value,version=1):
    if type(version)!=int or version not in [1,2]:raise ValueError('调色版本不支持')
    allowed=LEGACY_LIMITS if version==1 else {**LIMITS,**OPTIONAL_LIMITS}
    if not isinstance(value,dict) or set(value)-set(allowed):raise ValueError('调色参数无效')
    result={}
    for key,(low,high) in allowed.items():
        number=value.get(key,0)
        if isinstance(number,bool) or not isinstance(number,(int,float)) or not math.isfinite(number) or not low<=number<=high:raise ValueError('调色参数超出允许范围：'+key)
        rounded=round(number,3)
        # Keep neutral additions out of v2 recipes so existing request keys
        # and stored presets still compare equal after upgrading.
        if key not in OPTIONAL_LIMITS or rounded:
            result[key]=rounded
    return result

def load_image(path):
    with Image.open(path) as source:
        if source.width*source.height>60000000 or source.mode not in ['RGB','RGBA','L','LA','P']:raise ValueError('调色支持6000万像素以内的8位图片')
        profile=source.info.get('icc_profile');image=ImageOps.exif_transpose(source).convert('RGBA');alpha=image.getchannel('A');rgb=image.convert('RGB')
    if profile:
        try:rgb=ImageCms.profileToProfile(rgb,ImageCms.ImageCmsProfile(io.BytesIO(profile)),ImageCms.createProfile('sRGB'),outputMode='RGB')
        except Exception as e:raise ValueError('无法正确读取图片色彩配置，请先转换为 sRGB 图片') from e
    rgb.putalpha(alpha);return rgb

def base_adjust(image,p):
    alpha=image.getchannel('A');image=image.convert('RGB')
    tint=p.get('tint',0)
    if p['exposure'] or p['warmth'] or tint:
        warmth=p['warmth']*.003
        magenta=tint*.0015
        tables=[]
        for gain in [1+warmth+magenta,1-2*magenta,1-warmth+magenta]:
            for n in range(256):
                c=n/255;linear=(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4)*2**p['exposure']*gain
                encoded=12.92*linear if linear<=.0031308 else 1.055*linear**(1/2.4)-.055
                tables.append(max(0,min(255,round(encoded*255))))
        image=image.point(tables)
    if p['contrast']:image=ImageEnhance.Contrast(image).enhance(1+p['contrast']/100)
    if p['saturation']:image=ImageEnhance.Color(image).enhance(1+p['saturation']/100)
    image.putalpha(alpha);return image

def detail_maps(image):
    lum=ImageOps.grayscale(image);short=min(image.size)
    return {k:ImageChops.subtract(lum,lum.filter(ImageFilter.GaussianBlur(radius)),offset=128) for k,radius in [('clarity',max(1,short*.015)),('texture',max(.5,short*.002))]}

def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)

def adjust_v2(source,p,details=None):
    image=base_adjust(source,p);alpha=image.getchannel('A');image=image.convert('RGB')
    if any(p[k] for k in ['highlights','shadows','whites','blacks']):
        lum=ImageOps.grayscale(image);table=[]
        for n in range(256):
            x=n/255
            delta=p['highlights']/100*.25*smooth(.45,1,x)+p['shadows']/100*.30*(1-smooth(.05,.65,x))*smooth(0,.12,x)+p['whites']/100*.22*smooth(.70,1,x)+p['blacks']/100*.18*(1-smooth(0,.30,x))
            table.append(max(0,min(255,round(128+delta*255))))
        image=ImageChops.add(image,lum.point(table).convert('RGB'),offset=-128)
    if p['clarity'] or p['texture']:
        details=details or detail_maps(source);lum=ImageOps.grayscale(image);mask=lum.point([round(255*(4*(n/255)*(1-n/255))**.5) for n in range(256)]);neutral=Image.new('L',image.size,128)
        for k,gain in [('clarity',.012),('texture',.01)]:
            if p[k]:
                delta=details[k].point([max(0,min(255,round(128+(n-128)*p[k]*gain))) if abs(n-128)>1 else 128 for n in range(256)])
                delta=ImageChops.composite(delta,neutral,mask);image=ImageChops.add(image,delta.convert('RGB'),offset=-128)
    if sharpness:=p.get('sharpness',0):
        radius=max(.6,min(image.size)*.0006)
        image=image.filter(ImageFilter.UnsharpMask(radius=radius,percent=round(sharpness*1.5),threshold=2))
    image.putalpha(alpha);return image

def render(path,value,version=1):
    with RENDER_LOCK:
        p=settings(value,version);source=load_image(path)
        return base_adjust(source,p) if version==1 else adjust_v2(source,p)

def proxy(path,edge):
    stat=path.stat();key=(str(path),stat.st_mtime_ns,stat.st_size,edge)
    if key in PROXIES:
        PROXIES.move_to_end(key);return PROXIES[key]
    master_key=key[:3]
    if master_key not in MASTERS:
        image=load_image(path);size=list(image.size);image.thumbnail((1600,1600),Image.Resampling.LANCZOS);MASTERS[master_key]=(image,size)
        while len(MASTERS)>2:MASTERS.popitem(last=False)
    MASTERS.move_to_end(master_key);master,size=MASTERS[master_key];image=master.copy();image.thumbnail((edge,edge),Image.Resampling.LANCZOS)
    result=(image,size,detail_maps(image));PROXIES[key]=result
    while len(PROXIES)>4:PROXIES.popitem(last=False)
    return result

def png(image):
    out=io.BytesIO();image.save(out,format='PNG',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes());return out.getvalue()

class Retouch:
    def retouch_source(self,pid,aid):
        if self.store.project(pid)['status']!='active':raise ValueError('请先恢复项目再调色')
        a=self.store.asset(aid,pid)
        if a.get('trashed') or a.get('role')!='output':raise ValueError('请选择当前项目中可用的摄影作品')
        rel=a.get('original_local') or (a.get('local') if a.get('source')=='uploaded' and not a.get('preview_only') else None)
        if not rel:raise ValueError('请先成功加载高清原图，再进行调色；不会用低清预览代替原图')
        try:path=resolved_workspace_path(self.store.root,rel)
        except (OSError,RuntimeError,ValueError) as error:raise ValueError('本机原图暂不可读，请重新加载或导入原图') from error
        if not path.is_file():raise ValueError('本机原图暂不可读，请重新加载或导入原图')
        return a,path

    def retouch_preview(self,pid,aid,value,version=1,max_edge=1600,edit_current=False):
        started=time.perf_counter()
        if edit_current:_,path,_=self.adjustment_source(pid,aid)
        else:_,path=self.retouch_source(pid,aid)
        p=settings(value,version)
        if version==1:
            image=render(path,p);size=list(image.size);image.thumbnail((1600,1600),Image.Resampling.LANCZOS);raw=png(image);mime='image/png';edge=1600
        else:
            if type(max_edge)!=int or max_edge not in [480,720,1600]:raise ValueError('预览尺寸不支持')
            edge=max_edge
            with RENDER_LOCK:
                source,size,details=proxy(path,edge);image=adjust_v2(source,p,details)
            if image.getchannel('A').getextrema()==(255,255):
                out=io.BytesIO();image.convert('RGB').save(out,format='JPEG',quality=90,subsampling=0);raw=out.getvalue();mime='image/jpeg'
            else:raw=png(image);mime='image/png'
        return {'image':'data:'+mime+';base64,'+base64.b64encode(raw).decode(),'size':size,'settings':p,'max_edge':edge,'engine_version':version,'render_ms':round((time.perf_counter()-started)*1000,1)}

    def save_retouch(self,pid,aid,parent_id,value,request_key,version=1):
        source,path=self.retouch_source(pid,aid);p=settings(value,version)
        if not isinstance(request_key,str) or not 8<=len(request_key)<=100:raise ValueError('保存请求标识无效')
        parent=self.store.asset(parent_id,pid)
        if parent.get('trashed') or (parent_id!=aid and parent.get('retouch_base_id')!=aid):raise ValueError('调色来源与当前作品不一致')
        fingerprint={'base':aid,'parent':parent_id,'settings':p}
        def existing():
            match=next((a for a in self.store.assets(pid) if a.get('retouch_request')==request_key),None)
            if match and match.get('retouch_fingerprint')!=fingerprint:raise ValueError('保存内容已变化，请重新保存')
            return match
        with self.store.lock:
            previous=existing()
            if previous:return previous
        image=render(path,p,version);raw=png(image)
        if len(raw)>90*1024*1024:raise ValueError('调色结果超过90MB，未保存；请使用较小的原图')
        aid_new=uuid.uuid4().hex;rel='assets/retouch-'+aid_new+'.png';target=self.store.root/rel
        with self.store.lock:
            previous=existing()
            if previous:return previous
            # Recheck membership/state after rendering, before publishing a version.
            self.retouch_source(pid,aid)
            if self.store.asset(parent_id,pid).get('trashed'):raise ValueError('作品已移入回收站，未保存调色版')
            try:
                target.write_bytes(raw)
                with self.store.atomic():
                    result=self.store.put_asset({'id':aid_new,'name':(source['name'][:155]+' · 调色版'),'role':'output','source':'retouched','local':rel,'preview':'/files/'+rel,'original_local':rel,'original_saved':True,'original_size':list(image.size),'preview_only':False,'parent_id':parent_id,'retouch_base_id':aid,'retouch_settings':p,'retouch_version':version,'retouch_request':request_key,'retouch_fingerprint':fingerprint,'created_at':time.time(),**{k:source[k] for k in ['model','resolution','aspect_ratio','size'] if k in source}},pid)
                return result
            except BaseException:
                target.unlink(missing_ok=True);raise

    def adjustment_source(self,pid,aid):
        a=self.store.asset(aid,pid)
        if self.store.project(pid)['status']!='active' or a.get('trashed') or a.get('role')!='output':raise ValueError('请选择当前项目中可用的摄影作品')
        adjustment=a.get('photo_adjustment')
        if adjustment:
            path=self.store.purge_path(adjustment['base_local']).resolve();value=settings(adjustment['settings'],2)
            if not path.is_file():raise ValueError('本机原图暂不可读，请检查图片文件')
        else:
            base=aid;value=settings({},2)
            if a.get('retouch_version') in [1,2] and a.get('retouch_base_id'):
                try:
                    candidate=self.store.asset(a['retouch_base_id'],pid)
                    if not candidate.get('trashed'):base=candidate['id'];value=settings(a.get('retouch_settings',{}),2)
                except ValueError:pass
            _,path=self.retouch_source(pid,base)
        return a,path,value

    def adjustment_revision(self,a,path):
        stat=path.stat()
        return hashlib.sha256(json.dumps([a['id'],a.get('photo_adjustment'),str(path),stat.st_size,stat.st_mtime_ns],sort_keys=True).encode()).hexdigest()

    def retouch_context(self,pid,aid):
        try:a,path,value=self.adjustment_source(pid,aid)
        except ValueError:
            # Fetching the original is an existing explicit part of opening adjustment.
            a=self.store.asset(aid,pid)
            base=a.get('retouch_base_id') if a.get('retouch_version') in [1,2] else aid
            try:self.original(pid,base or aid)
            except ValueError:
                if base and base!=aid:self.original(pid,aid)
                else:raise
            a,path,value=self.adjustment_source(pid,aid)
        rel=path.relative_to(self.store.root.resolve()).as_posix()
        return {'asset':a,'settings':value,'revision':self.adjustment_revision(a,path),'baseline_url':media_url(rel,pid)}

    def confirm_retouch(self,pid,aid,value,revision,request_key,version=2):
        if version!=2:raise ValueError('调色版本不支持')
        p=settings(value,2)
        if not isinstance(request_key,str) or not 8<=len(request_key)<=100:raise ValueError('确认请求标识无效')
        def check():
            a,path,_=self.adjustment_source(pid,aid);old=a.get('photo_adjustment') or {}
            if old.get('request_key')==request_key:
                if old['settings']!=p:raise ValueError('确认内容已变化，请重新打开调色')
                return a,path,True
            if revision!=self.adjustment_revision(a,path):raise ValueError('这张作品已在其他窗口更新，请关闭后重新打开调色')
            return a,path,False
        with self.store.lock:
            a,path,done=check()
            if done:return a
        image=render(path,p,2) if any(p.values()) else None
        raw=png(image) if image else None
        if raw and len(raw)>90*1024*1024:raise ValueError('调色结果超过90MB，未确认；请使用较小的原图')
        base_rel=path.relative_to(self.store.root.resolve()).as_posix()
        rel='assets/adjustment-'+uuid.uuid4().hex+'.png' if raw else base_rel
        target=self.store.root/rel
        with self.store.lock:
            a,path,done=check()
            if done:return a
            old=a.get('photo_adjustment') or {};meta=dict(a['project_meta'])
            try:
                if raw:target.write_bytes(raw)
                with self.store.atomic():
                    meta['photo_adjustment']={'settings':p,'engine_version':2,'base_local':base_rel,'local':rel,'revision':uuid.uuid4().hex,'request_key':request_key}
                    self.store.db.execute('update project_assets set meta=? where project_id=? and asset_id=?',(json.dumps(meta,ensure_ascii=False),pid,aid))
                    if old.get('local') and old['local']!=rel:self.store.queue_file_deletion(old['local'])
            except BaseException:
                if raw:target.unlink(missing_ok=True)
                raise
            self.store.cleanup_deleted_files()
            return self.store.asset(aid,pid)
