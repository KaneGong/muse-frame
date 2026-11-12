#!/usr/bin/env python3
"""Local single-user portrait workbench. No credentials are stored here."""
import argparse,base64,hashlib,http.server,io,json,mimetypes,os,threading,time,uuid,urllib.parse,urllib.request,zipfile,atexit,signal,re,copy
from pathlib import Path
from bridge import CodexBridge,structured
from runtime import APP_ID,APP_NAME,VERSION,DEFAULT_PORT,data_dir,diagnostics,EDITION,EDITION_NAME,DEFAULT_CONNECTION
from connections import create_connection
import platforms
from store import MediaAccessError,Store
from media_paths import portable_workspace_path,resolved_workspace_path
from agent_channel import AgentChannel,AgentError
from reference_upload import prepare_upload
from executor_manager import ExecutorManager
from features import Features
from retouch import Retouch
from model_options import normalize_options,native_params,parameter_rejection

BASE=Path(__file__).resolve().parent
THUMB_LOCK=threading.Lock()
ALLOWED_ROLES={'face','body','outfit','scene','pose','output','source'}
# Lovart refuses a project id that belongs to another account. That refusal is
# pre-submit and safe to correct by dropping the id; it is not an ambiguous send.
STALE_PROJECT='not found on this account'

from prompt_contract import OPTIONAL_BODY_COMPILER,ROLES,validate_prompt_contract,referenced_numbers

EMPTY_PROMPT_HEADINGS={field+'：' for field in (
    '姿态参考','场景参考','场景','姿态与接触关系','表情','视线','人物细节',
    '摄影处理','妆容','发型','配饰','道具','时间','天气','光线','色调',
    '曝光与反差','景深','成片质感','构图与取景',
)}

def compact_prompt(value):
    """Keep prompt canonicalization identical to the client PromptEngine."""
    text=str(value or '')
    return '\n'.join(line for line in text.split('\n') if line.rstrip() not in EMPTY_PROMPT_HEADINGS)

def provider_error(result, fallback):
    error=result.get('error')
    message=(error.get('message') or error.get('code')) if isinstance(error,dict) else error
    return str(message)[:1000] if message else fallback

POSE_GALLERY = {
    'repo': 'anhao/ai-pose-gallery-zh',
    'author': 'ギア（@giaaibusi）',
    'data': 'https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/data/pose-zh.json',
    'site': 'https://ai-pose-gallery.pages.dev/',
    'ttl': 7 * 24 * 3600,
}
COSTUME_GALLERY = {
    'version': 'COSTUME-DB-01',
    'author': 'ギア（@giaaibusi）',
    'site': 'https://ai-costume-gallery.pages.dev/',
}

class App(Features,Retouch):
    def __init__(self,root):
        self.store=Store(root);self.platform=platforms.load(root)
        # Standalone owns its OAuth tokens. A fresh installation does not copy
        # other applications' credentials or automatically authorize a login.
        self.credentials={}
        if EDITION=='standalone':
            from token_store import ensure as own_tokens
            self.credentials=own_tokens(root)
        self.bridge=create_connection(platforms.connector(self.platform),BASE);self._bridges={self.platform:self.bridge};self.status={'state':'disconnected','message':'尚未连接 '+platforms.name(self.platform)};self.schemas={};self.catalog=[];self.stop=threading.Event();self.connecting=False;self.execution_lock=threading.RLock()
        self.init_features();self.store.recover();self.agent_channel=AgentChannel(self)
        # The standalone edition uses a direct platform connection. External Agent
        # routing remains available to other editions but is disabled here.
        if EDITION=='standalone':self.agent_channel.settings['enabled']=False
        elif self.agent_channel.settings.get('enabled'):self.status={'state':'disconnected','message':'等待 Agent 启动执行流程','executor':'external'}
        self.lovart_login_lock=threading.Lock()
        self.lovart_login_attempt=None
        self.executor_manager=ExecutorManager(self)
        threading.Thread(target=self.worker,daemon=True).start()
    @property
    def registration_lock(self):
        return getattr(self, '_registration_lock', self.execution_lock)

    def connect(self):
        if EDITION!="standalone" and self.agent_channel.settings.get("enabled"):raise ValueError("当前使用外部 Agent，请在连接设置中启动执行器，或先停用 Agent 接入")
        if self.connecting:return
        self.connecting=True
        self.connect_token=getattr(self,'connect_token',0)+1;token=self.connect_token
        # A platform switch can happen while this attempt is still waiting on the
        # network. Capture the bridge and name for this attempt so a late failure
        # can never close or overwrite the newly selected platform.
        bridge=self.bridge;platform=self.platform;name=platforms.name(platform)
        self.status={'state':'connecting','message':'正在连接 '+name+'…'}
        def run():
            try:
                catalog=structured(bridge.call('list_models',{'kind':'image'}))
                if token!=self.connect_token:return
                models=catalog.get('models') if isinstance(catalog,dict) else None
                if not isinstance(models,list) or not models or any(not isinstance(m,dict) or not isinstance(m.get('name'),str) or not m['name'].strip() for m in models):
                    raise RuntimeError('平台未返回有效的图像模型目录，请重新连接或稍后重试')
                self.catalog=models
                # 前端模型选择按供应商分组；LibTV 在 _list_models 里已带 vendor，
                # Lovart 的模型名是「厂商/型号」，这里按前缀补 vendor 并映射成友好名。
                _vendors={'vertex':'Google','openai':'OpenAI','seedream':'Seedream',
                          'ideogram':'Ideogram','luma':'Luma','fal':'fal.ai','qwenimage':'Qwen',
                          'bfl':'BFL','youchuan':'Midjourney'}
                for _m in self.catalog:
                    if not _m.get('vendor'):
                        _name=_m.get('name') or ''
                        _prefix=_name.split('/')[0] if '/' in _name else ''
                        _m['vendor']=_vendors.get(_prefix) or (_prefix or '其他')
                if token!=self.connect_token:return
                status={'state':'connected','message':name+' 已连接','credits':None,'concurrency_limit':None,'checked_at':time.time()}
                self.status=status
                self.connecting=False
                if platform=='lovart':
                    try:
                        credits=structured(bridge.call('get_credits',{}))
                        if token==self.connect_token and self.status is status and isinstance(credits,dict):
                            status.update(credits=credits.get('credits'),concurrency_limit=credits.get('concurrency_limit'),checked_at=time.time())
                    except Exception:pass
            except Exception as e:
                try:bridge.close()
                except Exception:pass
                if token!=self.connect_token:return
                self.catalog=[];self.schemas={}
                self.status={'state':'disconnected','message':str(e)[:700]}
            finally:
                if token==self.connect_token:self.connecting=False
        threading.Thread(target=run,daemon=True).start()
    def switch_platform(self,platform_id):
        if not isinstance(platform_id,str):raise ValueError('请选择绘图平台')
        if platform_id==self.platform:return self.platform_state()
        bridge=create_connection(platforms.connector(platform_id),BASE)
        platforms.save(self.store.root,platform_id)
        # Invalidate any in-flight attempt before the old bridge is closed; its
        # eventual timeout must not land on the new platform.
        self.connect_token=getattr(self,'connect_token',0)+1
        self.connecting=False
        old_platform=self.platform;old=self.bridge
        bridges=getattr(self,'_bridges',{});bridges[old_platform]=old;bridges[platform_id]=bridge;self._bridges=bridges
        with self.execution_lock,self.registration_lock:
            self.platform=platform_id;self.bridge=bridge;self.catalog=[];self.schemas={}
            self.status={'state':'disconnected','message':'尚未连接 '+platforms.name(platform_id)}
        # Invalidate any in-flight connect so its catalog cannot land on the new platform.
        self.connect_token=getattr(self,'connect_token',0)+1
        self.connecting=False
        self.connect()
        return self.platform_state()
    def platform_state(self):
        return {'current':self.platform,'name':platforms.name(self.platform),
                'options':platforms.listing(),'connection':self.status}
    def _selection_path(self):
        return self.store.root/'model-selection.json'
    def model_selection(self):
        try:return json.loads(self._selection_path().read_text()) or {}
        except (OSError,ValueError):return {}
    def save_model_selection(self,p):
        platform=self.platform
        if p.get('platform',platform)!=platform:raise ValueError('绘图平台已切换，请重新打开模型列表')
        names=p.get('models')
        if not isinstance(names,list):raise ValueError('请选择要使用的模型')
        valid={m.get('name') for m in self.catalog}
        if any(n not in valid for n in names):raise ValueError('包含平台目录之外的模型，请重新选择')
        sel=self.model_selection()
        if names:sel[platform]=list(dict.fromkeys(names))
        else:sel.pop(platform,None)
        self._selection_path().write_text(json.dumps(sel,ensure_ascii=False,indent=2))
        return {'selection':sel}
    def diagnose(self):
        issues=[]
        state=self.status.get('state','disconnected')
        if state=='connected':
            if not self.catalog:issues.append({'level':'error','title':'模型目录为空','message':'平台返回了 0 个图像模型','fix':'点击「诊断」重试，或切换到另一个平台'})
        elif state=='connecting':
            issues.append({'level':'info','title':'正在连接','message':self.status.get('message',''),'fix':'稍候片刻，连接完成后自动更新'})
        else:
            issues.append({'level':'error','title':'未连接绘图平台','message':self.status.get('message',''),'fix':'点击「连接」重新连接；若提示授权，先点「授权登录」'})
        import token_store
        tok=token_store.path('lovart.json' if self.platform=='lovart' else 'libtv.json')
        if state!='connected' and not Path(tok).is_file():
            issues.append({'level':'warn','title':'尚未完成授权','message':'本机没有找到 '+platforms.name(self.platform)+' 的授权','fix':'点击「授权登录」在浏览器完成一次授权'})
        return {'ok':not any(i.get('level')=='error' for i in issues),'issues':issues,'connection':self.status}
    def start_libtv_login(self):
        import threading
        from libtv_direct import login
        def run():
            try:login()
            except Exception as error:print('[libtv] login:',error,flush=True)
        threading.Thread(target=run,daemon=True).start()
        return {'started':True,'note':'已在浏览器打开 LibTV 授权页；完成后点“连接”即可。'}
    def vision_state(self):
        import vision_direct
        return {'vision':vision_direct.describe(self.store.root),'edition':EDITION}
    def save_vision(self,p):
        import vision_direct
        base=str(p.get('base_url') or '').strip().rstrip('/')
        model=str(p.get('model') or '').strip()
        if not base.startswith('https://') and not base.startswith('http://127.0.0.1') and not base.startswith('http://localhost'):
            raise ValueError('请填写完整接口地址，例如 https://open.bigmodel.cn/api/coding/paas/v4')
        if not model:raise ValueError('请填写模型名称，例如 glm-4.5v 或 Qwen/Qwen3-VL-32B-Instruct')
        path=self.store.root/'vision.json'
        cfg={}
        if path.is_file():
            try:cfg=json.loads(path.read_text())
            except (OSError,ValueError):cfg={}
        key=str(p.get('api_key') or '').strip()
        if key:
            keyfile=self.store.root/'vision-key.txt'
            keyfile.write_text(key)
            try:os.chmod(keyfile,0o600)
            except OSError:pass
            cfg.pop('api_key_env',None);cfg['api_key_file']='vision-key.txt'
        if not (cfg.get('api_key') or cfg.get('api_key_env') or cfg.get('api_key_file')):
            raise ValueError('请填写 API Key')
        cfg['base_url']=base;cfg['model']=model
        detail=str(p.get('detail') or '').strip()
        if detail in ('standard','detailed'):cfg['detail']=detail
        cfg.setdefault('detail','standard')
        path.write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
        return self.vision_state()
    def test_vision(self):
        import vision_direct
        return vision_direct.probe(self.store.root)
    def lovart_login_status(self):
        attempt=self.lovart_login_attempt
        return dict(attempt['status']) if attempt else {'state':'idle'}

    def start_lovart_login(self):
        import lovart_direct

        with self.lovart_login_lock:
            previous=self.lovart_login_attempt
            if previous and previous['thread'].is_alive():
                previous['cancel'].set()
                previous['thread'].join(1.5)
                if previous['thread'].is_alive():
                    return {'started':False,'state':'waiting','message':'正在结束上一次授权，请稍后再点重新授权。'}
            attempt={'cancel':threading.Event(),'status':{'state':'waiting','message':'请在浏览器完成 Lovart 授权。授权页关闭或报错时，可以在这里重新授权。'}}

            def run():
                try:
                    lovart_direct.login(lovart_direct.default_token_path(),cancelled=attempt['cancel'])
                except lovart_direct.LoginError as error:
                    attempt['status']={'state':'failed','message':str(error)}
                    return
                except Exception:
                    attempt['status']={'state':'failed','message':'本机未能完成 Lovart 授权，请重试。'}
                    return
                if self.platform=='lovart':
                    self.bridge.close()
                    self.connect()
                attempt['status']={'state':'authorized','message':'Lovart 授权成功。'}

            thread=threading.Thread(target=run,daemon=True)
            attempt['thread']=thread
            self.lovart_login_attempt=attempt
            thread.start()
            status=self.lovart_login_status()
            return {'started':True,'note':status['message'],**status}

    def _bridge_for_platform(self,platform):
        if platform==getattr(self,'platform','lovart'):return self.bridge
        bridges=getattr(self,'_bridges',{})
        bridge=bridges.get(platform)
        if bridge is None:
            bridge=create_connection(platforms.connector(platform),BASE)
            bridges[platform]=bridge;self._bridges=bridges
        return bridge
    def model_schema(self,model,bridge=None,platform=None,refresh=False):
        if getattr(self,'agent_channel',None) and self.agent_channel.settings.get('enabled'):
            if not self.agent_channel.info()['ready']:raise ValueError('等待 Agent 连接，请启动执行流程')
            if model not in self.agent_channel.schemas:raise ValueError('执行器未提供此模型参数')
            return self.agent_channel.schemas[model]
        current=getattr(self,'platform','lovart')
        if bridge is None:
            if platform is not None and platform!=current:raise ValueError('绘图平台已切换，请重新选择模型')
            if self.status['state']!='connected':raise ValueError('请先连接绘图平台')
            if model not in {x['name'] for x in self.catalog}:raise ValueError('当前模型目录没有此模型')
            bridge=self.bridge
        platform=platform or current
        cache=self.schemas if platform==current else getattr(self,'_platform_schemas',{})
        if platform!=current:self._platform_schemas=cache
        key=model if platform==current else (platform,model)
        if refresh:cache.pop(key,None)
        if key not in cache:cache[key]=structured(bridge.call('describe_model',{'model':model,**({'refresh':True} if refresh and platform=='libtv' else {})}))['schema']
        return cache[key]
    @staticmethod
    def decode_image(encoded,limit=16*1024*1024):
        try:
            raw=base64.b64decode(encoded,validate=True)
            if not raw or len(raw)>limit:raise ValueError('图片体积无效')
            from PIL import Image
            with Image.open(io.BytesIO(raw)) as image:
                ext={'JPEG':'.jpg','PNG':'.png','WEBP':'.webp'}.get(image.format)
                size=image.size
                if not ext or size[0]*size[1]>60000000:raise ValueError('图片格式或尺寸不支持')
                image.verify()
            # JPEG verify() checks headers only; decoding also rejects truncated pixel data.
            with Image.open(io.BytesIO(raw)) as decoded:decoded.load()
            return raw,ext,size
        except Exception as e:
            raise ValueError('图片内容损坏、格式不支持或超过体积限制，请选择有效 JPEG、PNG、WebP 图片') from e
    def upload(self,name,role,encoded,pid,limit=16*1024*1024,*,metadata=None):
        if self.store.project(pid)['status']!='active':raise ValueError('请先恢复项目')
        if role not in ALLOWED_ROLES:raise ValueError('素材类型无效')
        raw,ext,_=self.decode_image(encoded,limit)
        aid=uuid.uuid4().hex;path=self.store.root/'assets'/(aid+ext);path.write_bytes(raw)
        relative=path.relative_to(self.store.root).as_posix()
        return self.store.put_asset({'id':aid,'name':str(name)[:180],'role':role,'local':relative,'preview':'/files/'+relative,'source':'uploaded','confirmed':False,**(metadata or {})},pid)
    def workbench_reference_standard(self,pid,role):
        standards={
            'face':('f009cba9893','人物图库','https://ai-portrait-gallery.pages.dev/'),
            'outfit':('SPR-0001','衣装集','https://ai-costume-gallery.pages.dev/'),
            'pose':('full_single_P001_side','姿态集','https://ai-pose-gallery.pages.dev/'),
        }
        if role not in standards:raise ValueError('此参考类型没有固定样板')
        source_id,credit,origin=standards[role]
        key=role+':'+source_id
        with self.store.lock:
            if self.store.project(pid)['status']!='active':raise ValueError('请先恢复项目')
            row=self.store.db.execute("""
                SELECT pa.asset_id FROM project_assets pa JOIN assets a ON a.id=pa.asset_id
                 WHERE pa.project_id=? AND json_extract(a.data,'$.workbench_format')=?
                   AND NOT COALESCE(json_extract(pa.meta,'$.trashed'),0)
                 LIMIT 1
            """,(pid,key)).fetchone()
            if row:return {'id':row['asset_id']}
            encoded=base64.b64encode((BASE/'static/reference-standards'/f'{role}.webp').read_bytes()).decode()
            asset=self.upload('格式样板 · '+credit+' · '+source_id,'source',encoded,pid,metadata={
                'workbench_format':key,'format_credit':credit,'format_origin':origin,
            })
            return {'id':asset['id']}
    def upload_builtin_pose(self,pid,pose_id):
        library=json.loads((BASE/'static/library.json').read_text());pose=next((p for p in library['poses'] if p['id']==pose_id),None)
        if not pose:raise ValueError('姿态不存在')
        existing=next((a for a in self.store.assets(pid) if a.get('builtin_pose_id')==pose_id and not a.get('trashed')),None)
        if existing:return existing
        data=json.loads((BASE/'static/assets.json').read_text()).get(pose_id,'')
        if not data.startswith('data:image/'):raise ValueError('该姿态暂未提供图片')
        asset=self.upload(pose['name']+' · 姿态示意','pose',data.split(',',1)[1],pid)
        raw=self.store.asset(asset['id']);raw['builtin_pose_id']=pose_id;self.store.put_asset(raw);return self.store.asset(asset['id'],pid)
    def _gallery_cache(self):
        return self.store.root/'pose-gallery'/'pose-zh.json'

    def pose_gallery(self,refresh=False):
        """姿势库清单：首次或过期时联网拉取，之后离线可用。"""
        path=self._gallery_cache()
        fresh=path.exists() and (time.time()-path.stat().st_mtime)<POSE_GALLERY['ttl']
        if refresh or not fresh:
            try:
                request=urllib.request.Request(POSE_GALLERY['data'],headers={'User-Agent':'AI-Portrait-Studio/1.0'})
                with urllib.request.urlopen(request,timeout=30) as response:
                    raw=response.read(8*1024*1024+1)
                if raw and len(raw)<=8*1024*1024:
                    path.parent.mkdir(parents=True,exist_ok=True)
                    path.write_bytes(raw)
            except Exception:
                if not path.exists():
                    raise ValueError('姿势库清单下载失败，请检查网络后重试')
        items=json.loads(path.read_text())
        return {'version':1,'source':POSE_GALLERY['repo'],'author':POSE_GALLERY['author'],
                'cached':fresh and not refresh,'fetched_at':int(path.stat().st_mtime),
                'items':[{'id':item['id'],'sys':item['体系'],'num':item['姿势编号'],
                          'cat':item['分类'],'name':item['姿势名称'],'angle':item['角度'],
                          'thumb':item['缩略图'],'orig':item['原图']} for item in items]}

    # ---- 内置服装库（COSTUME-DB-01）：目录随包内置，原寸按需下载 ----
    def costume_gallery(self):
        path=BASE/'static/costumes.json'
        if not path.is_file():raise ValueError('服装库数据缺失，请重新安装')
        if not hasattr(self,'_costume_catalog'):
            self._costume_catalog=json.loads(path.read_text(encoding='utf-8'))
        catalog=self._costume_catalog
        return {'version':catalog.get('version',COSTUME_GALLERY['version']),
                'source':COSTUME_GALLERY['site'],'author':catalog.get('author',COSTUME_GALLERY['author']),
                'count':catalog['count'],'categories':catalog['categories'],
                'items':[{'id':i['id'],'cat':i['cat'],'kw':i['kw'],'zh':i['zh']} for i in catalog['items']]}

    def _costume_item(self,cid):
        catalog=self.costume_gallery()
        item=next((i for i in catalog['items'] if i['id']==cid),None)
        if not item:raise ValueError('服装库中没有这一项')
        category=next((c for c in catalog['categories'] if c['name']==item['cat']),{})
        return item,category

    def _costume_original(self,cid):
        item,_=self._costume_item(cid)
        folder=self.store.root/'costumes';folder.mkdir(exist_ok=True)
        target=folder/(cid+'.png')
        if target.is_file() and target.stat().st_size>12000:return target
        url=urllib.parse.urljoin(COSTUME_GALLERY['site'],'png/'+cid+'.png')
        raw=b''
        for attempt in range(3):
            try:
                request=urllib.request.Request(url,headers={'User-Agent':'AI-Portrait-Studio/1.0'})
                with urllib.request.urlopen(request,timeout=30) as response:raw=response.read(12*1024*1024+1)
                break
            except Exception:
                if attempt==2:raise ValueError('服装原图下载失败，请检查网络或稍后重试')
                time.sleep(1+attempt)
        if not raw.startswith(b'\x89PNG\r\n\x1a\n') or len(raw)<12000:raise ValueError('服装原图下载失败，请检查网络或稍后重试')
        temp=target.with_name(cid+'.'+uuid.uuid4().hex+'.part')
        try:
            temp.write_bytes(raw);os.replace(temp,target)
        finally:
            if temp.exists():temp.unlink(missing_ok=True)
        return target

    def import_gallery_costume(self,pid,cid):
        """按需下载原寸并转成本项目服装素材；同一套服装只导入一次。"""
        if not isinstance(cid,str) or not cid or len(cid)>40:raise ValueError('服装编号无效')
        item,category=self._costume_item(cid)
        for asset in self.store.assets(pid):
            if asset.get('costume_id')==cid and not asset.get('trashed'):return asset
        encoded=base64.b64encode(self._costume_original(cid).read_bytes()).decode()
        for asset in self.store.assets(pid):
            if asset.get('costume_id')==cid and not asset.get('trashed'):return asset
        name=(cid+' '+item.get('zh',''))[:60]
        asset=self.upload(name,'outfit',encoded,pid)
        record=self.store.asset(asset['id'])
        record['costume_id']=cid
        record['costume_meta']={'cat':category.get('label',item['cat']),'keywords':item['kw'],
                                'source':COSTUME_GALLERY['version'],'author':COSTUME_GALLERY['author']}
        self.store.put_asset(record)
        return self.store.asset(asset['id'],pid)

    def import_gallery_pose(self,pid,item_id,save_global=False):
        """按需下载原图并转成本项目姿态素材；同一姿势只导入一次。save_global 时同时存入全局姿态库。"""
        if not isinstance(item_id,str) or not item_id or len(item_id)>120:
            raise ValueError('姿势编号无效')
        existing=next((asset for asset in self.store.assets(pid) if asset.get('gallery_id')==item_id and not asset.get('trashed')),None)
        if existing and not save_global:return existing
        meta=existing.get('gallery_meta',{}) if existing else {}
        item={'id':item_id,**meta} if isinstance(meta,dict) and all(meta.get(k) for k in ('name','angle','cat')) else None
        if item is None:item=next((x for x in self.pose_gallery()['items'] if x['id']==item_id),None)
        if not item:
            raise ValueError('姿势库中没有这一项')
        if existing:
            try:path=resolved_workspace_path(self.store.root,existing.get('local'))
            except (OSError,RuntimeError,ValueError) as error:raise ValueError('本机姿势原图不存在，请重新导入') from error
            if not path.is_file():raise ValueError('本机姿势原图不存在，请重新导入')
            self._save_gallery_preset(item,path.read_bytes())
            return existing
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}',item_id) or item['orig']!='img/'+item_id+'.png':
            raise ValueError('姿势图片地址无效')
        payload=None
        try:
            request=urllib.request.Request(POSE_GALLERY['site']+item['orig'],headers={'User-Agent':'AI-Portrait-Studio/1.0'})
            with urllib.request.urlopen(request,timeout=60) as response:
                raw=response.read(12*1024*1024+1)
            if raw and (raw[:8]==b'\x89PNG\r\n\x1a\n' or raw[:3]==b'\xff\xd8\xff'):
                payload=raw
        except Exception:
            pass
        if not payload:
            raise ValueError('姿势原图下载失败，请检查网络或稍后重试')
        asset=self.upload('%s · %s' % (item['name'],item['angle']),'pose',base64.b64encode(payload).decode(),pid)
        record=self.store.asset(asset['id'])
        record['gallery_id']=item['id']
        record['gallery_meta']={'name':item['name'],'angle':item['angle'],'cat':item['cat'],
                                'sys':item['sys'],'source':POSE_GALLERY['repo'],'author':POSE_GALLERY['author']}
        self.store.put_asset(record)
        if save_global:
            self._save_gallery_preset(item,payload)
        return self.store.asset(asset['id'],pid)

    def _save_gallery_preset(self,item,payload):
        """把在线库姿态存入全局姿态库（含缩略图），所有项目可用。"""
        with self.store.lock:
            if any(p.get('field')=='pose' and p.get('gallery_pose_id')==item['id'] and not p.get('archived') for p in self.presets()):return
            self._save_new_gallery_preset(item,payload)

    def _save_new_gallery_preset(self,item,payload):
        from PIL import Image,ImageOps
        library=self.store.root/'library'/'poses';library.mkdir(parents=True,exist_ok=True)
        image=''
        try:
            im=Image.open(io.BytesIO(payload));im=ImageOps.exif_transpose(im)
            if im.mode not in ('RGB','L'):im=im.convert('RGB')
            im.thumbnail((600,900),Image.LANCZOS)
            filename='pose-'+uuid.uuid4().hex+'.jpg'
            im.save(library/filename,format='JPEG',quality=86,optimize=True)
            image='/library/poses/'+filename
        except Exception:
            image=''
        name='%s · %s' % (item['name'],item['angle'])
        self.save_preset({'field':'pose','name':name,'prompt':item['name'],'image':image,'category':item['cat'],'gallery_pose_id':item['id']})

    def _asset_local(self,aid,a,adjustment=None):
        """Return a usable local file for an asset, downloading from its URL when the
        capture step could not keep a copy. Raises a readable error otherwise."""
        rel=(adjustment or {}).get('local') or a.get('original_local') or a.get('local')
        if rel:
            if resolved_workspace_path(self.store.root,rel).is_file():
                return self.store.root/portable_workspace_path(rel)
        url=str(a.get('url') or '')
        if not url.startswith('https://'):
            raise ValueError('这张参考图既没有本地文件也没有可下载地址，请在对应步骤重新上传或重新生成')
        target=self.store.root/'assets'/(aid+'.jpg')
        target.parent.mkdir(parents=True,exist_ok=True)
        try:
            request=urllib.request.Request(url,headers={'User-Agent':'AI-Portrait-Studio/1.0'})
            with urllib.request.urlopen(request,timeout=60) as response:
                data=response.read(20*1024*1024+1)
        except Exception as error:
            raise ValueError('这张参考图缺少本地副本，自动下载也失败（%s）；请重新上传或重新生成这张图' % str(error)[:80])
        if not data or len(data)>20*1024*1024:
            raise ValueError('这张参考图的下载内容为空或过大，请重新上传或重新生成')
        target.write_bytes(data)
        if not adjustment:
            a['local']='assets/'+target.name
            self.store.put_asset(a)
        return target

    def hosted(self,aid,project_id=None,snapshot=None,remember=None,bridge=None,platform=None):
        a=self.store.asset(aid);adjustment=(snapshot or {}).get('photo_adjustment')
        cached=a.get('url')
        # A platform URL is only reusable on the platform that produced it.
        platform=platform or getattr(self,'platform','lovart');bridge=bridge or self._bridge_for_platform(platform)
        account_key=None
        if platform=='libtv':
            import libtv_direct
            account_key=libtv_direct._account_key(getattr(bridge,'token',None))
        if cached and not adjustment:
            _u=str(cached)
            _is_libtv=_u.startswith('libtv:') or '/upload-images/' in _u
            _is_lovart='lovart.ai' in _u
            if (platform=='libtv' and a.get('platform_node_id')
                    and a.get('account_key')==account_key
                    and a.get('platform_project_id')==project_id):
                return 'libtv:'+str(a['platform_node_id'])
            if (platform=='libtv' and _is_libtv
                    and a.get('account_key')==account_key
                    and a.get('platform_project_id')==project_id):return cached
            if platform=='lovart' and _is_lovart and (
                not a.get('design_ref_digest') or (project_id and a.get('lovart_project_id')==project_id)
            ):return cached
        prepared=prepare_upload(self.store.root,aid,self._asset_local(aid,a,adjustment))
        upload_args={'filename':Path(prepared['local_path']).name,'data_base64':prepared['base64']}
        if project_id:upload_args['project_id']=project_id
        if platform=='libtv':upload_args['upload_key']=aid+'-'+prepared['sha256']
        try:
            result=structured(bridge.call('upload_asset',upload_args))
        except Exception as e:
            # A platform project id from another account/session is unusable.
            # Dropping it is a pre-submit correction: nothing has been charged.
            if not (project_id and STALE_PROJECT in str(e)):raise
            upload_args.pop('project_id',None)
            result=structured(bridge.call('upload_asset',upload_args))
        if remember is not None and result.get('project_id'):
            remember['project_id']=result['project_id']
        if not adjustment and not (cached and a.get('source')=='generated'):
            a['url']=result['url']
            if platform=='lovart':a['lovart_project_id']=result.get('project_id') or project_id
            if result.get('platform_node_id'):
                a['platform_node_id']=result['platform_node_id']
                a['account_key']=account_key
                a['platform_project_id']=result.get('project_id') or project_id
            self.store.put_asset(a)
        return result['url']
    def enqueue(self,p):
        payload=copy.deepcopy(p['payload']);pid=p['project_id'];model=payload.get('model','')
        raw_prompt=payload.get('prompt','')
        if not isinstance(raw_prompt,str):raise ValueError('提示词必须为文字')
        prompt_contract=payload.get('prompt_contract')
        manual=isinstance(prompt_contract,dict) and prompt_contract.get('mode')=='manual'
        payload['prompt']=raw_prompt if manual else compact_prompt(raw_prompt)
        if payload.get('prompt_contract') and (payload.get('mode')!='generate' or payload.get('resultRole')!='output'):raise ValueError('提示词结构仅用于最终作品任务')
        if payload.get('mode') not in ['generate','edit'] or payload.get('resultRole') not in ALLOWED_ROLES:raise ValueError('任务类型无效')
        schema=self.model_schema(model);payload=normalize_options(schema,payload)
        if payload.get('mode')=='generate' and payload.get('resultRole')=='output':
            bindings=payload.get('ref_bindings',{})
            face=bindings.get('face')
            body=bindings.get('body') or (face if payload.get('bodyFromFace') else None)
            optional_body=isinstance(prompt_contract,dict) and prompt_contract.get('compiler')==OPTIONAL_BODY_COMPILER
            required={'face':'人物参考','outfit':'服装参考'}
            if not optional_body:
                required['body']='身形参考（或勾选沿用人物图）'
            bindings={**bindings,**({'body':body} if body else {})}
            missing=[name for role,name in required.items() if not bindings.get(role)]
            if missing:
                raise ValueError('请先准备：'+'、'.join(missing))
            active=[role for role in ROLES if bindings.get(role)]
            for role in active:
                allowed={role,'face'} if role=='body' else {role}
                if self.store.asset(bindings[role],pid).get('role') not in allowed:
                    raise ValueError('参考图角色不匹配，请按人物、身形、服装、环境和姿态分别选择')
            payload['refs']=[bindings[role] for role in active]
            payload['ref_bindings']=bindings
            contract=validate_prompt_contract(payload,payload['ref_bindings'])
            if contract is not None:payload['prompt_contract']=contract
            if bindings.get('pose') and contract is None:
                number=5 if bindings.get('scene') else 4
                if not re.search(r'^姿态参考：.*图'+str(number)+r'(?!\d)',payload['prompt'],re.M):raise ValueError('请核对姿态参考图编号与提示词')
                if not bindings.get('scene') and re.search(r'^姿态参考：.*支撑物本身取自图4环境中已有的物件',payload['prompt'],re.M):raise ValueError('姿态图4被旧提示词误写成环境图，请先修正')
        if payload.get('mode')=='edit' and not payload.get('refs'):raise ValueError('请选择要修改的图片')
        refs=payload.get('refs',[])
        for aid in refs:
            if self.store.asset(aid,pid).get('trashed'):raise ValueError('请先恢复参考图')
        maximum=max([0]+(referenced_numbers(payload['prompt']) if payload.get('prompt_contract') else [int(n) for n in re.findall(r'图(\d+)',payload['prompt'])]))
        if maximum>len(refs):raise ValueError('提示词包含未绑定的图片编号，请核对参考角色')
        if payload.get('pose_spec'):
            spec=payload['pose_spec']
            if payload.get('resultRole')!='pose' or not isinstance(spec,dict) or any(not isinstance(spec.get(k),str) or not spec[k].strip() or len(spec[k])>6000 for k in ['name','prompt','category']):raise ValueError('请填写姿态名称、动作描述与分类')
            payload['pose_spec']={k:spec[k] for k in ['name','prompt','category']}
        if payload.get('retry_of'):
            original=self.store.job(payload['retry_of'],pid)
            if original['state'] not in ['failed','cancelled']:raise ValueError('请先核对已有任务；仅已明确失败或取消的任务可重新提交')
        allowed=['retry_of','prompt','refs','model','aspect_ratio','resolution','mode','resultRole','ref_bindings','bodyFromFace','parent_asset','batch_id','batch_shot','batch_image','title','pose_spec','size','prompt_contract']
        payload={k:payload[k] for k in allowed if k in payload};payload['reference_snapshot']=[self.store.asset(x,pid) for x in refs]
        payload.setdefault('platform',getattr(self,'platform','lovart'))
        if getattr(self,'agent_channel',None) and self.agent_channel.settings.get('enabled'):
            cfg=self.agent_channel.settings
            if pid not in self.agent_channel.project_ids():raise ValueError('此项目未授权给 Agent，请在连接设置中选择当前项目')
            caps=next(m['capabilities'] for m in self.agent_channel.catalog if m['name']==model)
            if payload.get('refs') and 'references' not in caps:raise ValueError('当前平台模型未声明参考图能力')
            if payload['mode']=='edit' and 'edit' not in caps:raise ValueError('当前平台模型未声明修改图片能力')
            payload.update(executor='external',binding_id=cfg['binding_id'],platform=cfg['platform'])
        return self.store.enqueue(p['request_key'],pid,payload)
    def enqueue_batch(self,p):
        key=p.get('request_key');pid=p.get('project_id');count=p.get('count',1)
        payloads=p.get('payloads') if 'payloads' in p else [p.get('payload')]
        if not isinstance(key,str) or not 8<=len(key)<=150:raise ValueError('缺少有效提交标识')
        if type(count) is not int or not 1<=count<=4:raise ValueError('每个镜头生成1至4张')
        if not isinstance(payloads,list) or not 1<=len(payloads)<=25 or any(not isinstance(x,dict) for x in payloads):raise ValueError('镜头清单无效（最多25个）')
        requested_platform=p.get('platform')
        request_json=json.dumps({'count':count,'payloads':payloads,'platform':requested_platform},ensure_ascii=False,sort_keys=True,separators=(',',':'))
        # Serialize registration with platform switching, independently of
        # network activity for jobs that have already been registered.
        with self.registration_lock,self.store.atomic():
            existing=self.store.db.execute('select * from batch_requests where request_key=?',(key,)).fetchone()
            if existing:
                if existing['project_id']!=pid or existing['request_json']!=request_json:raise ValueError('同一提交标识对应的内容不同')
                return {'jobs':[self.store.job(jid,pid) for jid in json.loads(existing['job_ids'])]}
            if requested_platform and requested_platform!=getattr(self,'platform','lovart'):
                raise ValueError('当前平台已切换，请切回原平台后重新提交')
            jobs=[]
            for shot,payload in enumerate(payloads):
                payload=copy.deepcopy(payload);payload['batch_id']=key
                for index in range(count):
                    item={**payload,'batch_shot':shot+1,'batch_image':index+1}
                    jobs.append(self.enqueue({'project_id':pid,'request_key':f'{key}-{shot}-{index}','payload':item}))
            self.store.db.execute('insert into batch_requests values(?,?,?,?)',(key,pid,request_json,json.dumps([j['id'] for j in jobs])))
            return {'jobs':jobs}
    def capture(self,job,raw,meta):
        artifacts=meta.get('artifacts') or [];previews=[c for c in raw.get('content',[]) if c.get('type')=='image']
        if not artifacts or any(not isinstance(a,dict) or not a.get('url') for a in artifacts):raise ValueError('平台已结束但未返回可用图片；请重新读取已有结果，不要重复生成。')
        saved=[]
        for i,artifact in enumerate(artifacts):
            aid=job['id']+'-'+str(i)
            with self.store.lock:
                if self.store.was_purged(job['project_id'],aid):continue
                a={'id':aid,'name':('生成参考' if job['payload'].get('resultRole')!='output' else '摄影作品')+' · '+job['id'][:6], 'role':job['payload'].get('resultRole','output'),'url':artifact['url'],'source':'generated','job_id':job['id'],'confirmed':False,'original_size':[artifact.get('width'),artifact.get('height')],'original_saved':False,'edit_url':meta.get('edit_url'),'parent_id':job['payload'].get('parent_asset'),'model':job['payload'].get('model'),'aspect_ratio':job['payload'].get('aspect_ratio'),'resolution':job['payload'].get('resolution'),'size':job['payload'].get('size'),'task_id':next(iter(job.get('task_ids') or []),None)}
                if artifact.get('platform_node_id'):
                    a['platform_node_id']=artifact['platform_node_id']
                    if job['payload'].get('platform')=='libtv':
                        import libtv_direct
                        bridge=self._bridge_for_platform('libtv')
                        a['account_key']=libtv_direct._account_key(getattr(bridge,'token',None))
                        a['platform_project_id']=(job.get('result') or {}).get('project_id') or getattr(bridge,'project',None)
                if i<len(previews):
                    ext='.png' if previews[i].get('mimeType')=='image/png' else '.jpg'
                    rel='previews/'+aid+ext;(self.store.root/rel).write_bytes(base64.b64decode(previews[i]['data']))
                    a.update(preview='/files/'+rel,local=rel,preview_only=True)
                if job['payload'].get('pose_spec'):a['pose_spec']=job['payload']['pose_spec']
                self.store.put_asset(a,job['project_id']);saved.append(aid)
        meta['asset_ids']=saved;return meta
    def submit(self,job):
        platform=job['payload'].get('platform') or getattr(self,'platform','lovart');bridge=self._bridge_for_platform(platform)
        if platform==getattr(self,'platform','lovart'):
            schema=self.model_schema(job['payload']['model'])
        else:
            schema=self.model_schema(job['payload']['model'],bridge=bridge,platform=platform)
        p,params=native_params(schema,job['payload'])
        _pr=self.store.project(job['project_id']);_pp=(_pr['data'].get('platform_projects') or {})
        # Jobs created before platform was persisted are legacy records; treat
        # their missing marker as the current platform, but never borrow an
        # explicitly different platform's project id.
        project_id=_pp.get(platform) or next(((j.get('result') or {}).get('project_id') for j in self.store.jobs(job['project_id']) if (j.get('payload') or {}).get('platform',platform)==platform and (j.get('result') or {}).get('project_id')),None)
        snapshots={a['id']:a for a in p.get('reference_snapshot',[])}
        def prepare_references(project):
            urls, uploaded = [], {}
            for aid in p.get('refs', []):
                if aid not in uploaded:
                    snapshot=snapshots.get(aid,{})
                    fresh={}
                    url=self.hosted(aid,project,snapshot if snapshot.get('photo_adjustment') else None,
                                    fresh,bridge=bridge,platform=platform)
                    resolved=fresh.get('project_id') or project
                    if platform=='lovart' and p.get('design') and not resolved:
                        raise ValueError('Lovart 未确认参考图所属项目，本次未发起生成。')
                    if platform=='lovart' and urls and resolved!=project:
                        return None,resolved
                    project=resolved
                    uploaded[aid]=url
                urls.append(uploaded[aid])
            return urls,project

        original_refs,project_id=prepare_references(project_id)
        if original_refs is None:
            original_refs,project_id=prepare_references(project_id)
            if original_refs is None:
                raise ValueError('Lovart 参考图无法归入同一项目，未发起生成，请检查连接后再试。')
        refs=list(dict.fromkeys(original_refs)) if platform=='libtv' else original_refs
        if platform=='lovart' and not project_id:
            try:
                _created=structured(bridge.call('create_project',{'name':_pr['name'][:40]}))
                project_id=_created.get('project_id') or _created.get('id')
            except Exception:
                project_id=None
        args={'model':p['model'],'prompt':p['prompt'],'params':params}
        receipt={}
        if platform=='libtv' and hasattr(bridge,'prepare_submission'):
            receipt=bridge.prepare_submission(job['id'],p['prompt'])
            args['receipt']=receipt
            project_id=receipt['project_id']
        elif project_id:
            receipt={'project_id':project_id}
        if project_id:args['project_id']=project_id
        def invoke():
            # structured() is what raises a platform refusal, not the transport:
            # the call returns an isError payload. Keep it inside the retry so a
            # "this project is not yours" refusal is corrected before any charge.
            attempt=copy.deepcopy(args)
            if p.get('mode')=='edit':
                attempt.update(images=refs)
                if platform=='libtv':
                    attempt['ref_slots']=original_refs
                    if p.get('size'):attempt['size']=p['size']
                    elif p['aspect_ratio']!='default':attempt['aspect_ratio']=p['aspect_ratio']
                raw=bridge.call('edit_image',attempt)
            else:
                attempt.update(ref_images=refs,n=1)
                if platform=='libtv':attempt['ref_slots']=original_refs
                if not p.get('size') and p['aspect_ratio']!='default':attempt['aspect_ratio']=p['aspect_ratio']
                raw=bridge.call('generate_image',attempt)
            return raw,structured(raw)
        # State is committed before external side effect. Ambiguous submissions never auto-retry.
        self.store.update(job['id'],state='submitting',result=receipt or None)
        try:
            try:
                raw,meta=invoke()
            except Exception as e:
                # Only a pre-submit "this project is not yours" refusal is retried,
                # and only after dropping the stale id. A platform rejection after
                # the call was accepted is never resent.
                if not (platform=='lovart' and args.get('project_id') and STALE_PROJECT in str(e)):raise
                if p.get('design'):
                    self.store.update(job['id'],state='preparing',result=None)
                    created=structured(bridge.call('create_project',{'name':_pr['name'][:40]}))
                    replacement=created.get('project_id') or created.get('id')
                    if not replacement:
                        raise ValueError('Lovart 未确认新项目，本次未重新发起生成。')
                    refs,replacement=prepare_references(replacement)
                    if refs is None:
                        raise ValueError('Lovart 参考图未能归入新项目，本次未重新发起生成。')
                    args['project_id']=replacement
                    receipt={'project_id':replacement}
                    self.store.update(job['id'],state='submitting',result=receipt)
                else:
                    args.pop('project_id',None)
                    receipt={}
                    self.store.update(job['id'],result=None)
                raw,meta=invoke()
            meta={**receipt,**meta}
            ids=meta.get('task_ids')
            if ids:
                # Preserve the accepted task ids before optional project metadata
                # maintenance, so a local write failure cannot lose recovery ids.
                self.store.update(job['id'],task_ids=ids,state='running',result=meta,error=None)
                _mid=meta.get('project_id')
                if _mid and _pp.get(platform)!=_mid:
                    # The network call may outlive a user save. Merge only the
                    # backend-owned mapping into the latest project snapshot.
                    with self.store.lock:
                        current=self.store.project(job['project_id'])['data']
                        current['platform_projects']={**(current.get('platform_projects') or {}),platform:_mid}
                        self.store.set_project_data(job['project_id'],current)
            elif meta.get('status')=='completed':self.store.update(job['id'],state='completed',result=self.capture(job,raw,meta),error=None)
            elif meta.get('status')=='needs_review':
                self.store.update(job['id'],state='needs_review',result=meta,error=provider_error(meta,'平台回执不完整'))
            else:self.store.update(job['id'],state='failed',result=meta,error=provider_error(meta,'生成未成功'))
        except Exception as e:
            message=str(e)
            refused=(self.store.job(job['id'])['state']=='preparing' or parameter_rejection(message)
                     or 'NODE_NAME_CONFLICT' in message or 'NODE_VALIDATION_FAILED' in message)
            if platform=='libtv':
                from libtv_direct import PreparationError
                refused=refused or isinstance(e,PreparationError)
            note=('；参数或节点被平台拒绝，修改后可手动生成新任务。' if refused
                  else '；请核对 '+platforms.name(platform)+' 已有任务，操作台不会重复提交。')
            self.store.update(job['id'],state='failed' if refused else 'needs_review',error=message[:1000]+note)
    def poll(self,job):
        platform=job['payload'].get('platform') or getattr(self,'platform','lovart');bridge=self._bridge_for_platform(platform)
        identity={k:v for k,v in (job.get('result') or {}).items()
                  if k in ('project_id','node_id','node_name','submission_key','review_released')}
        args={'task_ids':job['task_ids'],'project_id':identity.get('project_id')}
        if platform=='libtv':
            if not identity.get('node_id') and identity.get('node_name') and hasattr(bridge,'find_generation'):
                try:
                    found=bridge.find_generation(identity)
                    if found.get('task_id') in (job.get('task_ids') or []) and found.get('node_id'):
                        identity['node_id']=found['node_id']
                except (RuntimeError,OSError,ValueError):
                    pass
            if identity.get('node_id'):args['node_id']=identity['node_id']
        raw=bridge.call('get_task_status',args);meta=structured(raw)
        status=meta.get('status')
        if status=='completed':
            try:
                raw=bridge.call('get_task',{**args,'include_images':True});meta={**identity,**structured(raw)}
                result=self.capture(job,raw,meta)
            except ValueError as e:
                self.store.update(job['id'],state='needs_review',result=meta,error=str(e));return
            self.store.update(job['id'],state='completed',result=result,error=None)
            if platform=='lovart':
                try:
                    credits=structured(bridge.call('get_credits',{}))
                    if platform==getattr(self,'platform','lovart'):self.status.update(credits=credits.get('credits'),checked_at=time.time())
                except Exception:pass
        elif status=='not_found':
            self.store.update(job['id'],state='needs_review',result={**identity,**meta},
                              error=provider_error(meta,'平台暂未找到已有任务，请核对原项目。'))
        elif status=='cancelled':
            self.store.update(job['id'],state='cancelled',result={**identity,**meta},error=None)
        elif status in ['failed','moderated']:
            self.store.update(job['id'],state='failed',result={**identity,**meta},error=provider_error(meta,'平台未返回有效结果'))
        elif status in ('pending','running','queued','processing'):
            self.store.update(job['id'],state='running',result={**identity,**meta},error=None)
        else:self.store.update(job['id'],result={**identity,**meta},error='平台返回的状态暂无法识别')
    def recheck(self,pid,jid):
        with self.execution_lock:
            job=self.store.job(jid,pid)
            if job['payload'].get('executor')=='external':return self.agent_channel.request_recheck(pid,jid)
            if job['state']!='needs_review' or not job.get('task_ids'):raise ValueError('没有可重新读取的平台任务')
            self.poll(job)
            return self.store.job(jid,pid)
    def worker(self):
        while not self.stop.wait(2):
            if getattr(self,'agent_channel',None) and self.agent_channel.settings.get('enabled'):
                self.agent_channel.expire_analyses()
                if not self.agent_channel.info()['ready']:self.status={'state':'disconnected','message':'等待 Agent 启动执行流程','executor':'external'}
                continue
            running=[];job=None
            try:
                running=self.store.running_internal()
                if running:
                    j=min(running,key=lambda item:item['updated'])
                    if time.time()-j['updated']>=15:
                        with self.execution_lock:
                            current=self.store.job(j['id'])
                            if current['state']=='running':
                                job=current
                                self.poll(current)
                        continue
                # Submit independent one-image jobs while up to four are active
                # at the platform. Submission itself remains serialized, so an
                # uncertain response blocks later jobs in that batch before claim.
                advertised=self.status.get('concurrency_limit')
                limit=min(4,advertised) if type(advertised) is int and advertised>0 else 4
                if len(running)>=limit:continue
                # A queued job has not reached the platform. Keep it queued while
                # the selected connection is unavailable, including app startup.
                if self.status.get('state')!='connected':continue
                job=self.store.claim()
                if job:
                    try:
                        with self.execution_lock:
                            if self.store.job(job['id'])['state']=='preparing':self.submit(job)
                    except Exception as e:self.store.update(job['id'],state='failed',error=str(e)[:1000])
            except Exception as e:
                current=getattr(self,'platform','lovart')
                active_platform=(job or {}).get('payload',{}).get('platform')
                if job and job['state']=='running':
                    # Keep the existing platform id and retry reads fairly: a
                    # failing oldest task must not starve every later result.
                    self.store.update(job['id'],error='读取已有任务失败：'+str(e)[:900])
                if active_platform in (None,current):
                    self.status={**self.status,'state':'disconnected','message':'执行连接中断：'+str(e)[:500]}
                    try:self.bridge.close()
                    except Exception as close_error:
                        self.status['message']+='；连接回收失败：'+str(close_error)[:200]
    def preview_asset(self,aid,pid):
        a=self.store.asset(aid,pid)
        if a.get('local'):return a
        job=self.store.job(a['job_id'],pid) if a.get('job_id') else None
        ids=(job.get('task_ids') or []) if job else ([a['task_id']] if a.get('task_id') else [])
        if not ids:raise ValueError('这项素材没有可读取的任务预览，请上传本地图片')
        args={'task_ids':ids,'include_images':True}
        if job and (job.get('result') or {}).get('project_id'):args['project_id']=job['result']['project_id']
        platform=(job or {}).get('payload',{}).get('platform') or getattr(self,'platform','lovart');bridge=self._bridge_for_platform(platform)
        raw=bridge.call('get_task',args)
        imgs=[x for x in raw.get('content',[]) if x.get('type')=='image']
        if not imgs:raise ValueError('平台未返回预览')
        with self.store.lock:
            self.store.asset(aid,pid)
            rel='previews/'+a['id']+'.jpg';(self.store.root/rel).write_bytes(base64.b64decode(imgs[0]['data']));raw_asset=self.store.asset(aid);raw_asset.update(local=rel,preview='/files/'+rel,preview_only=True);self.store.put_asset(raw_asset);return self.store.asset(aid,pid)

    def cancel(self,pid,jid):
        with self.execution_lock:
            j=self.store.job(jid,pid)
            if j['payload'].get('executor')=='external' and j['state'] not in ['queued','completed','failed','cancelled']:return self.agent_channel.request_cancel(pid,jid)
            if j['state'] in ['queued','preparing']:
                self.store.update(jid,state='cancelled',error=None);return
            if j['state']!='running' or not j['task_ids']:raise ValueError('当前任务不能取消；已提交但未知编号时需先核对')
            if j['payload'].get('executor')=='external':raise ValueError('任务已由外部 Agent 领取，请让执行器核对平台；此处不会假定平台已取消')
            platform=j['payload'].get('platform') or getattr(self,'platform','lovart');bridge=self._bridge_for_platform(platform)
            cancel_tool='task_cancel' if platform=='libtv' else 'cancel_task'
            if cancel_tool not in bridge.tools:raise ValueError('当前连接未提供取消能力，请在'+platforms.name(platform)+'核对')
            project_id=(j.get('result') or {}).get('project_id')
            target={'project_id':project_id} if platform=='libtv' and project_id else {}
            results=[structured(bridge.call('cancel_task',{'task_id':tid,**target})) for tid in j['task_ids']]
            if all(x.get('cancelled') for x in results):self.store.update(jid,state='cancelled',error=None)
            else:raise ValueError(next((x.get('message') for x in results if not x.get('cancelled')),None) or '平台任务已开始，无法取消；将继续回收结果')
    def cancel_batch_pending(self,pid,batch_id):
        if not isinstance(batch_id,str) or not batch_id:raise ValueError('批次无效')
        with self.execution_lock,self.store.atomic():
            self.store.project(pid)
            jobs=[j for j in self.store.jobs(pid) if j['batch_id']==batch_id]
            if not jobs:raise ValueError('批次不属于当前项目')
            pending=[j for j in jobs if j['state']=='queued']
            for j in pending:self.store.update(j['id'],state='cancelled',error='用户取消了本组尚未提交的任务')
            return {'cancelled':len(pending)}
    def export_project(self,pid):
        p=self.store.project(pid);assets=[]
        for a in self.store.assets(pid):
            a=copy.deepcopy(a)
            if a.get('local'):a['file_base64']=base64.b64encode((self.store.root/a['local']).read_bytes()).decode()
            elif a.get('preview','').startswith('data:image/') and ',' in a['preview']:a['file_base64']=a['preview'].split(',',1)[1]
            if a.get('original_local'):a['original_base64']=base64.b64encode((self.store.root/a['original_local']).read_bytes()).decode()
            if a.get('photo_adjustment'):
                _adj=a['photo_adjustment']
                _base=_adj.get('base_local');_local=_adj.get('local')
                if _base and (self.store.root/_base).exists():
                    a['adjustment_base_base64']=base64.b64encode((self.store.root/_base).read_bytes()).decode()
                if _local and (self.store.root/_local).exists():
                    a['adjustment_base64']=base64.b64encode((self.store.root/_local).read_bytes()).decode()
            assets.append(a)
        return {'version':2,'project':p,'assets':assets,'jobs':self.store.jobs(pid)}
    def import_project(self,p):
        if not isinstance(p,dict) or p.get('version') not in [1,2] or not isinstance(p.get('assets'),list):raise ValueError('项目包格式不支持')
        project=p.get('project')
        if not isinstance(project,dict) or not isinstance(project.get('name'),str) or not project['name'].strip() or not isinstance(project.get('data'),dict):raise ValueError('项目包缺少名称或拍摄方案')
        ids=set();prepared=[]
        for a in p['assets']:
            if not isinstance(a,dict) or not isinstance(a.get('id'),str) or not a['id'] or a['id'] in ids:raise ValueError('项目包图片编号无效或重复')
            ids.add(a['id'])
            if a.get('role','source') not in ALLOWED_ROLES:raise ValueError('项目包图片类型无效')
            for key in ['url','edit_url']:
                if a.get(key):
                    if not platforms.allow_image_url(a[key]):raise ValueError('项目包图片地址无效')
            encoded=a.get('file_base64') or (a.get('preview','').split(',',1)[1] if a.get('preview','').startswith('data:image/') and ',' in a['preview'] else None)
            if encoded:self.decode_image(encoded,90*1024*1024)
            if a.get('original_base64'):
                _,_,size=self.decode_image(a['original_base64'],90*1024*1024)
                expected=a.get('original_size') or [0,0]
                if len(expected)==2 and all(isinstance(x,int) and x>0 for x in expected) and (size[0]<expected[0] or size[1]<expected[1]):raise ValueError('项目包原图尺寸不足')
            if a.get('photo_adjustment'):
                from retouch import settings
                settings(a['photo_adjustment'].get('settings'),2)
                for field in ['adjustment_base_base64','adjustment_base64']:
                    if not a.get(field):raise ValueError('项目包缺少调色图片或原图')
                    self.decode_image(a[field],90*1024*1024)
            prepared.append((a,encoded))
        d=project['data']
        if not isinstance(d.get('refs',{}),dict) or not isinstance(d.get('savedResults',[]),list) or not isinstance(d.get('customPoses',[]),list) or not isinstance(p.get('jobs',[]),list):raise ValueError('项目包拍摄方案格式无效')
        if any(v and v not in ids for v in list(d.get('refs',{}).values())+d.get('savedResults',[])):raise ValueError('项目包引用了缺失图片')
        if any(not isinstance(pose,dict) for pose in d.get('customPoses',[])):raise ValueError('项目包姿态格式无效')
        shots=d.get('shots',[])
        if not isinstance(shots,list) or any(not isinstance(x,dict) for x in shots):raise ValueError('项目包镜头格式无效')
        pose_ids=[x.get('poseAsset') for x in shots if x.get('poseAsset')]
        spec=d.get('promptSpec')
        if spec is not None:
            if not isinstance(spec,dict) or spec.get('version')!=2 or not isinstance(spec.get('shots'),list):raise ValueError('项目包提示词结构版本不支持')
            for shot in spec['shots']:
                if not isinstance(shot,dict) or not isinstance(shot.get('pose'),dict):raise ValueError('项目包镜头姿态格式无效')
                if shot['pose'].get('assetId'):pose_ids.append(shot['pose']['assetId'])
        roles={a['id']:a.get('role','source') for a in p['assets']}
        if any(not isinstance(aid,str) or aid not in ids or roles[aid]!='pose' for aid in pose_ids):raise ValueError('项目包镜头引用了缺失或不匹配的姿态图片')
        files=[]
        try:
            with self.store.atomic():
                return self._import_validated(p,prepared,files)
        except BaseException:
            for path in files:path.unlink(missing_ok=True)
            raise
    def _import_validated(self,p,prepared,files):
        created=self.store.put_project(p['project']['name']+' · 导入',{'refs':{},'draft':''});pid=created['id'];mapping={}
        for a,encoded in prepared:
            if encoded:
                new=self.upload(a.get('name','导入图片'),a.get('role','source'),encoded,pid,limit=90*1024*1024);files.append(self.store.root/new['local'])
                raw=self.store.asset(new['id'])
                for k in ['url','platform_node_id','source','preview_only','original_size','model','resolution','aspect_ratio','created_at','edit_url','size','pose_spec','builtin_pose_id','retouch_settings','retouch_version','costume_id','costume_meta','gallery_id','gallery_meta','face_gallery_id','face_gallery_source']:
                    if k in a:raw[k]=a[k]
                self.store.put_asset(raw)
            else:new=self.store.put_asset({k:v for k,v in a.items() if k not in ['id','project_id','project_meta','file_base64','original_base64','local','preview','job_id','original_local','original_url','original_saved','photo_adjustment','display_url','adjusted','adjustment_base_base64','adjustment_base64']},pid)
            if a.get('original_base64'):
                original=self.attach_original(pid,new['id'],a['original_base64']);files.append(self.store.root/original['original_local'])
            if a.get('photo_adjustment'):
                adjustment=copy.deepcopy(a['photo_adjustment'])
                for field,key in [('adjustment_base_base64','base_local'),('adjustment_base64','local')]:
                    image_raw,mime,size=self.decode_image(a[field],90*1024*1024);rel='assets/adjustment-import-'+uuid.uuid4().hex+mime;target=self.store.root/rel;files.append(target);target.write_bytes(image_raw);adjustment[key]=rel
                meta=self.store.asset(new['id'],pid)['project_meta'];meta['photo_adjustment']=adjustment
                self.store.db.execute('update project_assets set meta=? where project_id=? and asset_id=?',(json.dumps(meta,ensure_ascii=False),pid,new['id']))
            mapping[a['id']]=new['id'];self.store.asset_action(pid,[new['id']],{k:a[k] for k in ['confirmed','favorite','adopted','trashed'] if k in a})
        for a in p['assets']:
            if a.get('parent_id') in mapping or a.get('retouch_base_id') in mapping:
                raw=self.store.asset(mapping[a['id']])
                for key in ['parent_id','retouch_base_id']:
                    if a.get(key) in mapping:raw[key]=mapping[a[key]]
                self.store.put_asset(raw)
        d=copy.deepcopy(p['project']['data']);d['refs']={k:mapping.get(v,'') for k,v in d.get('refs',{}).items()};d['savedResults']=[mapping[x] for x in d.get('savedResults',[]) if x in mapping]
        for pose in d.get('customPoses',[]):
            if pose.get('assetId') in mapping:pose['assetId']=mapping[pose['assetId']];pose['image']=self.store.asset(pose['assetId'],pid).get('preview','')
        for shot in d.get('shots',[]):
            if shot.get('poseAsset'):shot['poseAsset']=mapping[shot['poseAsset']]
        for shot in (d.get('promptSpec') or {}).get('shots',[]):
            if shot['pose'].get('assetId'):shot['pose']['assetId']=mapping[shot['pose']['assetId']]
            shot.pop('reviewedReferences',None)
        d['importedHistory']=d.get('importedHistory',[])+p.get('jobs',[]);d['pendingChanges']={};d['undo']=[]
        return self.store.put_project(created['name'],d,pid)
    def bundle(self,pid,ids):
        if not isinstance(ids,list) or not 1<=len(ids)<=200:raise ValueError('请选择要下载的图片')
        out=io.BytesIO();manifest=[]
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
            for index,aid in enumerate(ids):
                a=self.store.asset(aid,pid);entry={'name':a['name'],'original_url':a.get('url'),'preview_only':a.get('preview_only',False)}
                if a.get('photo_adjustment') and a['photo_adjustment'].get('local'):a={**a,'original_local':a['photo_adjustment']['local']};entry['adjusted']=a.get('adjusted',False)
                if a.get('original_local'):a={**a,'local':a['original_local'],'preview_only':False};entry['preview_only']=False
                if a.get('local'):
                    f=self.store.root/a['local'];z.writestr(f'{index+1:03d}'+('-preview' if a.get('preview_only') else '-original')+f.suffix,f.read_bytes())
                elif a.get('preview','').startswith('data:image/'):
                    z.writestr(f'{index+1:03d}-preview.jpg',base64.b64decode(a['preview'].split(',',1)[1]));entry['preview_only']=True
                manifest.append(entry)
            z.writestr('图片清单与原图入口.json',json.dumps(manifest,ensure_ascii=False,indent=2))
        return out.getvalue()

class StudioServer(http.server.ThreadingHTTPServer):
    # 前端一次加载 20+ 个脚本；默认 backlog(5) 会让并发请求被重置。
    request_queue_size = 128
    daemon_threads = True

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*a):pass
    def valid_host(self):return self.headers.get('Host') in [f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}']
    def send(self,data,status=200,ctype='application/json; charset=utf-8',download=None,cache='no-store'):
        raw=json.dumps(data,ensure_ascii=False).encode() if isinstance(data,(dict,list)) else data
        self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(raw)));self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('Cache-Control',cache);self.send_header('Connection','close')
        if download:self.send_header('Content-Disposition','attachment; filename="'+download+'"')
        self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if not self.valid_host():return self.send({'error':'Host 不允许'},403)
        url=urllib.parse.urlparse(self.path);path=url.path;q=urllib.parse.parse_qs(url.query);app=self.server.app
        try:
            if path=='/api/health':return self.send({'app_id':APP_ID,'version':VERSION,'pid':os.getpid()})
            if path=='/api/setup':return self.send({**diagnostics(),'active_connection':app.status,'agent_channel':app.agent_channel.info(),'executor_manager':(app.executor_manager.info() if hasattr(app,'executor_manager') else None),'onboarding':{'dismissed':(app.store.root/'connection-guide-seen').exists()},'platform':{'current':app.platform,'options':platforms.listing()},'credentials':(None if EDITION!='standalone' else __import__('token_store').info(app.store.root)),'vision':None})
            if path=='/api/vision':
                if EDITION=='standalone':return self.send({'error':'此版本已取消外部识图功能'},410)
                return self.send(app.vision_state())
            if path=='/api/diagnose':return self.send(app.diagnose())
            if path=='/api/platform':return self.send(app.platform_state())
            if path=='/api/lovart-login':return self.send(app.lovart_login_status())
            if path=='/api/state':
                _sel=app.model_selection().get(getattr(app,'platform','lovart'))
                return self.send({'version':2,'connection':{**app.status,**({'authorized_project_ids':app.agent_channel.project_ids(),'agent':app.agent_channel.agent_name or 'AGENT','agent_identity_source':app.agent_channel.agent_identity_source,'platform':app.agent_channel.settings.get('platform'),'executor_capabilities':app.agent_channel.executor_capabilities} if getattr(app,'agent_channel',None) and app.agent_channel.settings.get('enabled') else {})},'projects':app.store.projects(),'models':[{**m,'selected':(m.get('name') in _sel) if _sel else True} for m in app.catalog],'task_summary':app.task_summary() if hasattr(app.store,'on_job_state') else None,'executor_manager':(app.executor_manager.info() if hasattr(app,'executor_manager') else None),'vision':None,'platform':{'current':getattr(app,'platform','lovart'),'name':platforms.name(getattr(app,'platform','lovart')),'options':platforms.listing()},'file_cleanup_pending':app.store.pending_file_cleanup()})
            if path in ['/api/project','/api/reuse-source']:
                pid=q['id'][0];return self.send({'project':app.store.project(pid),'assets':app.store.assets(pid),'jobs':app.store.jobs(pid) if path=='/api/project' else []})
            if path=='/api/workbench/works':return self.send({'groups':app.store.workbench_works(q['project_id'][0])})
            if path=='/api/presets':return self.send({'presets':app.presets(),'categories':app.preset_categories()})
            if path=='/api/pose-gallery':return self.send(app.pose_gallery(q.get('refresh',[''])[0]=='1'))
            if path=='/api/costume-gallery':return self.send(app.costume_gallery())
            if path=='/api/face-gallery':
                import face_gallery
                return self.send(face_gallery.catalog())
            if path=='/api/pose-analysis-results':return self.send({'analyses':app.analysis_results(q['project_id'][0])})
            if path=='/api/pose-analysis':return self.send(app.analysis(q['project_id'][0],q['id'][0]))
            if path=='/api/schema':return self.send(app.model_schema(q['model'][0],platform=q.get('platform',[None])[0],refresh=q.get('refresh',['0'])[0]=='1'))
            if path=='/api/export':return self.send(app.export_project(q['id'][0]))
            if path.startswith('/library/'):
                root=app.store.root;rel=urllib.parse.unquote(path[9:]);f=(root/'library'/rel).resolve()
                if not f.is_relative_to((root/'library').resolve()) or not rel.startswith('poses/'):return self.send({'error':'路径不允许'},403)
                if not f.is_file():return self.send({'error':'文件不存在'},404)
                return self.send(f.read_bytes(),ctype=mimetypes.guess_type(f)[0] or 'image/jpeg',cache='private, max-age=86400')
            if path.startswith('/thumbs/'):
                root=app.store.root;rel=urllib.parse.unquote(path[8:]);pid=q.get('project_id',[''])[0]
                f=app.store.project_media_path(pid,rel)
                if not f.is_file():return self.send({'error':'文件不存在'},404)
                try:width=int(q.get('w',['360'])[0])
                except ValueError:width=360
                width=max(64,min(width,1600))
                cache_dir=root/'thumbs';cache_dir.mkdir(exist_ok=True)
                key=hashlib.sha1(('%s|%s|%s'%(f,f.stat().st_mtime_ns,width)).encode()).hexdigest()+'.jpg'
                cache_file=cache_dir/key
                if not cache_file.is_file():
                    with THUMB_LOCK:
                        if not cache_file.is_file():
                            from PIL import Image,ImageOps
                            with Image.open(f) as image:
                                image=ImageOps.exif_transpose(image)
                                if image.width*image.height>60000000:raise ValueError('图片像素过大')
                                if image.mode not in ('RGB','L'):image=image.convert('RGB')
                                image.thumbnail((width,10**6),Image.LANCZOS)
                                buffer=io.BytesIO();image.save(buffer,format='JPEG',quality=82,optimize=True,progressive=True)
                            temporary=cache_file.with_suffix('.tmp');temporary.write_bytes(buffer.getvalue());os.replace(temporary,cache_file)
                return self.send(cache_file.read_bytes(),ctype='image/jpeg',cache='private, max-age=86400')
            if path.startswith('/files/'):
                rel=urllib.parse.unquote(path[7:]);pid=q.get('project_id',[''])[0]
                f=app.store.project_media_path(pid,rel)
            else:
                root=BASE/'static';f=(root/('index.html' if path=='/' else path.lstrip('/'))).resolve()
                if not f.is_relative_to(root.resolve()):return self.send({'error':'路径不允许'},403)
            if not f.is_file():return self.send({'error':'文件不存在'},404)
            content=f.read_bytes()
            if f==(BASE/'static/index.html').resolve():
                content=content.replace(b'data-edition="open"',('data-edition="'+EDITION+'"').encode()).replace('AI人像摄影 Studio · AI Portrait Studio</title>'.encode(),(('映象所 · MUSE FRAME' if EDITION=='standalone' else 'AI人像摄影 Studio · '+EDITION_NAME)+'</title>').encode())
                # 给每个脚本按文件修改时间加版本参数：脚本一改 URL 就变，浏览器
                # 不会继续复用缓存里的旧前端（no-store 并不足以阻止同名脚本复用）。
                def _script_tag(match):
                    name=match.group(1).decode()
                    try:
                        stamp=int((BASE/'static'/name).stat().st_mtime)
                    except OSError:
                        return match.group(0)
                    return ('<script src="/%s?v=%d"' % (name,stamp)).encode()
                content=re.sub(rb'<script src="/([A-Za-z0-9_.-]+\.js)(?:\?[^"]*)?"',_script_tag,content)
            # Image files are content-stable per asset id; a short private cache
            # stops every 4s status refresh from re-fetching and flashing them.
            return self.send(content,ctype=mimetypes.guess_type(f)[0] or 'application/octet-stream',
                             cache=('private, max-age=300' if path.startswith('/files/') else 'no-store'))
        except MediaAccessError as e:self.send({'error':str(e)},403)
        except (KeyError,ValueError) as e:self.send({'error':str(e)},400)
        except Exception:self.send({'error':'读取失败，请检查项目或连接状态。'},500)
    def agent_post(self):
        if not self.valid_host():return self.send({'code':'E_HOST','error':'Host 不允许'},403)
        channel=self.server.app.agent_channel
        if not channel.authorized(self.headers.get('X-Studio-Token','')):return self.send({'code':'E_AUTH','error':'Agent 未授权或授权已撤销'},401)
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.send({'code':'E_CONTENT_TYPE','error':'请使用 JSON'},415)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=24*1024*1024:return self.send({'code':'E_SIZE','error':'请求体积无效'},413)
            p=json.loads(self.rfile.read(length))
            if not isinstance(p,dict) or not isinstance(p.get('arguments',{}),dict):raise ValueError('请求内容无效')
            return self.send(channel.call(p.get('tool'),p.get('arguments',{})))
        except AgentError as e:return self.send({'code':e.code,'error':str(e)},409 if e.code in ['E_BUSY','E_STATE','E_CLAIM','E_EXECUTOR_BUSY','E_CONFLICT'] else 400)
        except (KeyError,ValueError,TypeError) as e:return self.send({'code':'E_INPUT','error':str(e)[:500]},400)
        except Exception:return self.send({'code':'E_INTERNAL','error':'操作未完成，请检查本机日志'},500)
    def do_POST(self):
        if urllib.parse.urlparse(self.path).path=='/api/agent/v1/call':return self.agent_post()
        if not self.valid_host():return self.send({'error':'Host 不允许'},403)
        origin=self.headers.get('Origin');expected='http://'+self.headers.get('Host','')
        if origin!=expected or self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.send({'error':'仅允许操作台同源请求'},403)
        try:
            path=urllib.parse.urlparse(self.path).path;length=int(self.headers.get('Content-Length',0));limit=(768 if path=='/api/import' else 150)*1024*1024
            if EDITION=='standalone' and path in ('/api/vision','/api/vision-test','/api/pose-analysis'):return self.send({'error':'此版本已取消外部识图功能'},410)
            if not 0<length<=limit:return self.send({'error':'项目包最大768MB' if path=='/api/import' else '请求体积无效'},413)
            p=json.loads(self.rfile.read(length))
            if not isinstance(p,dict):raise ValueError('请求内容必须是对象')
            app=self.server.app;pid=p.get('project_id')
            if path=='/api/shutdown':
                if any(j['state'] in ['queued','preparing','submitting','running','cancelling'] for j in app.store.jobs()) or app.store.db.execute("select 1 from analyses where state='running'").fetchone():raise ValueError('仍有生成或识图任务，请等待结束后再退出')
                app.stop.set();threading.Thread(target=self.server.shutdown,daemon=True).start();r={'ok':True}
            elif path=='/api/executor/configure':r=app.executor_manager.configure(p)
            elif path=='/api/executor/start':r=app.executor_manager.start()
            elif path=='/api/executor/stop':r=app.executor_manager.stop()
            elif path=='/api/executor/reconnect':r=app.executor_manager.reconnect()
            elif path=='/api/onboarding':
                (app.store.root/'connection-guide-seen').write_text('1');r={'ok':True}
            elif path=='/api/job-archive':r=app.archive_job(pid,p['id'],p['archived'])
            elif path=='/api/agent-config':r=app.agent_channel.configure(p)
            elif path=='/api/connect':app.connect();r={'ok':True}
            elif path=='/api/vision':r=app.save_vision(p)
            elif path=='/api/model-selection':r=app.save_model_selection(p)
            elif path=='/api/vision-test':r=app.test_vision()
            elif path=='/api/lovart-login':r=app.start_lovart_login()
            elif path=='/api/platform':r=app.switch_platform(p.get('platform'))
            elif path=='/api/libtv-login':r=app.start_libtv_login()
            elif path=='/api/notices-read':r=app.read_notices(pid)
            elif path=='/api/completion-sound':r=app.set_sound(p['enabled'])
            elif path=='/api/test-sound':r={'played':app.play_sound()}
            elif path=='/api/pose-gallery-import':r=app.import_gallery_pose(pid,p['id'],bool(p.get('save_global')))
            elif path=='/api/costume-gallery-import':r=app.import_gallery_costume(pid,p['id'])
            elif path=='/api/face-gallery-import':
                import face_gallery
                r=face_gallery.import_image(app,pid,p['id'])
            elif path=='/api/upload-pose-builtin':r=app.upload_builtin_pose(pid,p['id'])
            elif path=='/api/project':r=app.store.put_project(p['name'],p['data'],p.get('id'),p.get('revision'))
            elif path=='/api/project-action':r=app.store.project_action(pid,p['action'])
            elif path=='/api/project-purge':r=app.store.purge_project(pid)
            elif path=='/api/preset':r=app.save_preset(p)
            elif path=='/api/preset-purge':r=app.purge_preset(p)
            elif path=='/api/pose-purge':r=app.purge_pose(p)
            elif path=='/api/assets-purge-plan':r=app.store.purge_plan(pid,p['ids'])
            elif path=='/api/assets-purge':r=app.store.purge_assets(pid,p['ids'],p.get('token'))
            elif path=='/api/file-cleanup':r=app.store.cleanup_deleted_files()
            elif path=='/api/preset-category':r=app.save_preset_category(p)
            elif path=='/api/preset-category-delete':r=app.delete_preset_category(p)
            elif path=='/api/attach-original':r=app.attach_original(pid,p['id'],p['base64'])
            elif path=='/api/original':r=app.original(pid,p['id'],retry=p.get('retry') is True)
            elif path=='/api/retouch-preview':r=app.retouch_preview(pid,p['id'],p['settings'],p.get('engine_version',1),p.get('max_edge',1600),p.get('edit_current',False))
            elif path=='/api/retouch-context':r=app.retouch_context(pid,p['id'])
            elif path=='/api/retouch-confirm':r=app.confirm_retouch(pid,p['id'],p['settings'],p['revision'],p['request_key'],p.get('engine_version',2))
            elif path=='/api/retouch-save':raise ValueError('调色流程已更新，请刷新工作台后使用“确认调整”；本次未新增作品')
            elif path=='/api/pose-analysis':r=app.start_analysis(pid,p['asset_id'])
            elif path=='/api/workbench/reference-standard':r=app.workbench_reference_standard(pid,p['role'])
            elif path=='/api/upload':r=app.upload(p['name'],p['role'],p['base64'],pid)
            elif path=='/api/assets-action':r={'assets':app.store.asset_action(pid,p['ids'],p['changes'])}
            elif path=='/api/reuse':r={'assets':app.store.reuse(p['source_project'],pid,p['ids'])}
            elif path=='/api/preview':r=app.preview_asset(p['id'],pid)
            elif path=='/api/jobs':
                r=app.enqueue_batch(p)
            elif path=='/api/cancel':app.cancel(pid,p['id']);r={'ok':True}
            elif path=='/api/cancel-batch-pending':r=app.cancel_batch_pending(pid,p['batch_id'])
            elif path=='/api/recheck':r=app.recheck(pid,p['id'])
            elif path=='/api/link-task':
                j=app.store.job(p['id'],pid);task=p['task_id']
                if j['state']!='needs_review' or not isinstance(task,str) or not 8<len(task)<100:raise ValueError('只允许为待核对任务关联已有任务编号')
                if j['payload'].get('executor')=='external':app.agent_channel.request_recheck(pid,j['id'],task)
                else:app.store.update(j['id'],state='running',task_ids=[task],error=None)
                r={'ok':True}
            elif path=='/api/close-review':r=app.agent_channel.close_review(p)
            elif path=='/api/import':r=app.import_project(p)
            elif path=='/api/bundle':return self.send(app.bundle(pid,p['ids']),ctype='application/zip',download=('MUSE-FRAME-selected.zip' if EDITION=='standalone' else 'portrait-selected.zip'))
            else:return self.send({'error':'接口不存在'},404)
            self.send(r)
        except (ValueError,KeyError,TypeError) as e:self.send({'error':str(e)},400)
        except Exception as e:self.send({'error':str(e)[:800]},500)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=DEFAULT_PORT);parser.add_argument('--data',default=str(data_dir()));parser.add_argument('--no-connect',action='store_true');args=parser.parse_args()
    app=App(Path(args.data).resolve());server=StudioServer(('127.0.0.1',args.port),Handler);server.app=app
    atexit.register(app.bridge.close)
    if not args.no_connect:app.connect()
    print(f'{APP_NAME}：http://127.0.0.1:{args.port}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:app.stop.set();server.server_close();app.bridge.close()
