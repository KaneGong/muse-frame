#!/usr/bin/env python3
"""Hermes 本机 Lovart 执行器，contract v3。
默认完成连接后持续待命，只执行用户在网页提交的任务。
--check 仅检查连接；--execute 是默认行为的兼容写法。保持同一 MCP 会话。
认证由 Hermes 原生 MCP 客户端管理，不读取或复制凭据。
"""
import argparse,asyncio,base64,json,sys,time,urllib.request,urllib.parse,os,contextlib,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WORKER_DIR=Path(__file__).resolve().parent
# The source worker lives in app/, while the packaged worker and its helper
# modules are bundled together under Contents/Resources/executor/.
sys.path.insert(0,str(WORKER_DIR))
from model_options import native_params
STUDIO_CMD=str(ROOT/'outputs/agent-alpha-final/Portrait Studio MCP')
STUDIO_DATA=str(ROOT/'work/agent-ui-test')
OUTDIR=Path(STUDIO_DATA)/'executor-results'

def parse(result):
    wire=result if isinstance(result,dict) else result.model_dump(by_alias=True)
    if wire.get('isError') or wire.get('is_error'):
        import re
        codes=re.findall(r'E_[A-Z_]+',' '.join(str(c.get('text','')) for c in wire.get('content',[])))
        raise RuntimeError('MCP工具失败，后续操作已停止 '+('/'.join(codes) if codes else 'E_TOOL'))
    data=wire.get('structuredContent')
    if data is None:data=wire.get('structured_content')
    if data is not None:
        if not isinstance(data,dict):raise ValueError('工具数据不是对象')
        return data
    for item in wire.get('content',[]):
        if item.get('type')=='text':
            try:data=json.loads(item['text'])
            except (ValueError,KeyError):continue
            if isinstance(data,dict):return data
    raise ValueError('工具没有返回可解析数据，停止而不是猜测')

class MCPCallFailure(RuntimeError):
    def __init__(self,tool,exc):
        import re
        from platform_metadata import safe_platform_message
        self.tool=tool;self.original_type=type(exc).__name__
        detail=re.sub(r'(?i)([\"\']?(?:token|secret|password|cookie|authorization|api_key)[\"\']?\s*[:=]\s*)[\"\'][^\"\']*[\"\']',r'\1[redacted]',str(exc))
        detail=re.sub(r'https?://[^\s]+','[平台地址]',detail)
        detail=re.sub(r'[A-Za-z0-9+/=_-]{100,}','[长数据省略]',detail)
        self.detail=safe_platform_message(detail,350)
        super().__init__('E_MCP_SESSION: '+tool+' · '+self.original_type+' · '+self.detail)

async def call(session,tool,args=None):
    try:return parse(await session.call_tool(tool,arguments=args or {}))
    except Exception as exc:
        if type(exc).__name__.lower() in ['mcperror','closedresourceerror','brokenresourceerror','timeouterror']:
            failure=MCPCallFailure(tool,exc)
            # Never retain tool arguments, image data or authentication material.
            try:
                folder=Path(STUDIO_DATA)/'logs';folder.mkdir(parents=True,exist_ok=True)
                with (folder/'executor-errors.jsonl').open('a') as output:output.write(json.dumps({'time':time.time(),'tool':tool,'error_type':failure.original_type,'detail':failure.detail},ensure_ascii=False)+'\n')
            except OSError:pass
            raise failure from None
        raise


async def full_catalog(lov):
    response=await call(lov,'list_models',{'kind':'image'})
    if response.get('next_cursor') or response.get('has_more'):raise RuntimeError('平台目录已分页，必须更新适配后继续，不能静默漏掉模型')
    discovered=response.get('models');models=[];excluded=[]
    if not isinstance(discovered,list) or not discovered:raise RuntimeError('没有实际模型目录')
    for item in discovered:
        name=item['name']
        try:
            desc=await call(lov,'describe_model',{'model':name});schema=json.loads(json.dumps(desc['schema']));properties=schema['properties']
            # Project the platform's optional free-form size onto its real resolution
            # enum. The UI never supported arbitrary pixels; don't reject the model.
            size=properties.get('size',{})
            if size.get('type')=='string' and 'enum' not in size and 'size' not in schema.get('required',[]) and properties.get('resolution',{}).get('enum'):
                properties.pop('size');schema['x-studio-adaptation']={'size':'界面使用平台实际resolution枚举；暂不开放自定义像素尺寸'}
            caps=['generate']
            if any(k in properties for k in ['image','images','ref_images','source_image']):caps.append('references')
            modes={(m.get('mode','') if isinstance(m,dict) else str(m)).replace('_','-').lower() for m in schema.get('x-capabilities',{}).get('modes',[])}
            if 'mask' in properties or modes & {'image-to-image','edit','image-edit'}:
                if 'references' not in caps:caps.append('references')
                caps.append('edit')
            models.append({'name':name,'display_name':item.get('display_name') or name,'schema':schema,'capabilities':caps})
        except (ValueError,RuntimeError,KeyError):excluded.append({'name':name,'reason':'实际查询参数失败，未编造参数；需单独核查平台返回'})
    if not models:raise RuntimeError('所有模型参数查询均未成功')
    return models,{'discovered_count':len(discovered),'excluded':excluded}


PLATFORM_TOOLS=set()
EXECUTOR_INSTANCE_ID=os.environ.get('PORTRAIT_STUDIO_MANAGED_ID') or uuid.uuid4().hex
STUDIO_ARGS=None
def hermes_workspace(prefix=None,home=None):
    # A managed interpreter must load its matching checkout. Loading the legacy
    # checkout can trigger a late bootstrap exec during vision and lose MCP sessions.
    managed=Path(prefix or sys.prefix).parent/'workspace'
    return managed if (managed/'hermes_bootstrap.py').is_file() else Path(home or Path.home())/'.hermes/hermes-agent'

def platform_metadata(result):
    from platform_metadata import result_metadata
    data={k:result[k] for k in ['project_id','edit_url','url','model','size','aspect_ratio','resolution','status','width','height','error','source','result_ready','message'] if result.get(k) is not None}
    artifacts=result.get('artifacts') or []
    if artifacts:
        data.update({k:artifacts[0][k] for k in ['url','width','height'] if artifacts[0].get(k) is not None})
    return result_metadata(data)

def failure_message(stage,exc):
    import re
    codes=re.findall(r'E_[A-Z_]+',str(exc))
    return stage+'（'+(exc.tool+'：'+exc.detail if isinstance(exc,MCPCallFailure) else '/'.join(codes) if codes else type(exc).__name__)+'）；不重新生成'

async def current_job(st,job):
    return (await call(st,'studio_job',{'job_id':job['id'],'claim_id':job['claim_id']}))['job']

async def prepare_references(st,lov,job):
    ids={'job_id':job['id'],'claim_id':job['claim_id']};urls=[];manifest=[];project_id=job.get('platform_project_id') or (job.get('result') or {}).get('project_id')
    for aid in job['payload'].get('refs',[]):
        fresh=await current_job(st,job)
        if fresh.get('cancel_requested'):
            await call(st,'studio_progress',{**ids,'phase':'cancelled'});return None,None
        reference=await call(st,'studio_reference',{**ids,'asset_id':aid,'max_base64_chars':3_700_000})
        path=Path(reference['local_path'])
        if not path.is_absolute() or not path.is_file() or path.stat().st_size>2_775_000:raise ValueError('工作台上传件不可用或编码超限')
        encoded=base64.b64encode(path.read_bytes()).decode()
        if len(encoded)>3_700_000:raise ValueError('工作台上传件base64仍超限')
        args={'filename':path.name,'data_base64':encoded}
        if project_id:args['project_id']=project_id
        upload=await call(lov,'upload_asset',args);url=upload.get('url')
        if not isinstance(url,str) or not url.startswith('https://'):raise ValueError('平台未返回有效图片引用')
        if upload.get('project_id') and not project_id:
            project_id=upload['project_id'];job['platform_project_id']=project_id
            await call(st,'studio_progress',{**ids,'phase':'preparing','platform_result':{'project_id':project_id}})
        urls.append(url);manifest.append({'asset_id':aid,'platform_reference':url})
    return urls,manifest

def generation_arguments(payload,urls,schema,project_id=None):
    p,params=native_params(schema,payload);args={'prompt':p['prompt'],'model':p['model'],'params':params}
    if project_id:args['project_id']=project_id
    if p['mode']=='edit':args['images']=urls;tool='edit_image'
    else:
        tool='generate_image';args.update(ref_images=urls,n=1)
        if not p.get('size') and p.get('aspect_ratio','default')!='default':args['aspect_ratio']=p['aspect_ratio']
    return tool,args

def download(url,path):
    host=urllib.parse.urlparse(url).hostname or ''
    if not url.startswith('https://') or not (host=='lovart.ai' or host.endswith('.lovart.ai')):raise ValueError('仅回收Lovart实际返回的HTTPS原图')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**kw):return None
    request=urllib.request.Request(url,headers={'User-Agent':'AI-Portrait-Studio/0.3'})
    path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_suffix('.partial');size=0
    try:
        with urllib.request.build_opener(NoRedirect).open(request,timeout=45) as response,temporary.open('wb') as output:
            while True:
                chunk=response.read(1024*1024)
                if not chunk:break
                size+=len(chunk)
                if size>100*1024*1024:raise ValueError('原图超过100MiB限制，保留平台结果供核对')
                output.write(chunk)
        os.replace(temporary,path)
    finally:temporary.unlink(missing_ok=True)

async def save_result(st,lov,job,result):
    ids={'job_id':job['id'],'claim_id':job['claim_id']};meta={**(job.get('result') or {}),**platform_metadata(result)}
    if not meta.get('url'):raise RuntimeError('平台没有返回真实原图地址')
    meta['status']='completed'
    # Persist the source before a potentially failing download, including inline results.
    await call(st,'studio_progress',{**ids,'phase':'result_ready','platform_result':platform_metadata(meta)})
    path=OUTDIR/(job['id']+'.image');path.parent.mkdir(parents=True,exist_ok=True)
    await asyncio.to_thread(download,meta['url'],path)
    await call(st,'studio_complete',{**ids,'local_path':str(path),'platform_result':platform_metadata(meta)})
    path.unlink(missing_ok=True) # canonical workbench original was acknowledged
    return True

async def follow_job(st,lov,job,wait=False):
    ids={'job_id':job['id'],'claim_id':job['claim_id']}
    while True:
        fresh=await current_job(st,job);job={**job,**fresh}
        if job['state'] in ['completed','failed','cancelled']:return True
        task_ids=job.get('task_ids') or [];meta=job.get('result') or {}
        if not task_ids:
            if meta.get('url'):return await save_result(st,lov,job,meta)
            return False
        if job.get('cancel_requested'):
            if 'cancel_task' in PLATFORM_TOOLS:
                answers=[await call(lov,'cancel_task',{'task_id':tid}) for tid in task_ids]
                if all(r.get('cancelled') is True for r in answers):
                    await call(st,'studio_progress',{**ids,'phase':'cancelled','cancellation_confirmed':True});return True
            await call(st,'studio_progress',{**ids,'phase':'cancel_rejected','message':'平台未确认取消，继续查询并回收原任务'})
        query={'task_ids':task_ids};project=meta.get('project_id') or job.get('platform_project_id')
        if project:query['project_id']=project
        await call(st,'studio_heartbeat');status=await call(lov,'get_task_status',query);state=status.get('status')
        if state in ['cancelled','canceled']:
            await call(st,'studio_progress',{**ids,'phase':'cancelled','cancellation_confirmed':True});return True
        if state in ['failed','moderated','not_found']:
            message={'failed':'平台明确返回生成失败','moderated':'平台审核未通过','not_found':'平台未找到此任务，请核对编号'}[state]
            await call(st,'studio_progress',{**ids,'phase':'failed','message':message,'platform_result':platform_metadata(status)});return True
        if state=='completed':
            result=await call(lov,'get_task',{**query,'include_images':False});return await save_result(st,lov,job,result)
        if not wait:return False
        await asyncio.sleep(6)

async def run_job(st,lov,job,schemas):
    if job.get('state')!='preparing':raise ValueError('恢复任务只能核对，不能再次生成')
    ids={'job_id':job['id'],'claim_id':job['claim_id']};payload=job['payload'];submitting=False
    try:
        fresh=await current_job(st,job)
        if fresh.get('cancel_requested'):
            await call(st,'studio_progress',{**ids,'phase':'cancelled'});return
        urls,manifest=await prepare_references(st,lov,job)
        if urls is None:return
        tool,args=generation_arguments(payload,urls,schemas[payload['model']],job.get('platform_project_id'))
        await call(st,'studio_progress',{**ids,'phase':'submitting','reference_uploads':manifest,'submission':{'tool':tool,'arguments':args}})
        submitting=True;generated=await call(lov,tool,args);meta=platform_metadata(generated)
        task_ids=generated.get('task_ids') or ([generated['task_id']] if generated.get('task_id') else [])
        if generated.get('status') in ['failed','moderated']:
            await call(st,'studio_progress',{**ids,'phase':'failed','message':'平台明确拒绝或未能生成','platform_result':meta});return
        if task_ids:
            await call(st,'studio_progress',{**ids,'phase':'running','task_ids':task_ids,'platform_result':meta})
            job.update(state='running',task_ids=task_ids,result=meta)
            await follow_job(st,lov,job,wait=False)
        elif generated.get('status')=='completed' and meta.get('url'):await save_result(st,lov,job,generated)
        else:raise RuntimeError('没有平台任务编号或同步结果，需核对')
    except Exception as exc:
        try:await call(st,'studio_progress',{**ids,'phase':'needs_review' if submitting else 'failed','message':failure_message('提交后读取中断，请核对已有平台结果' if submitting else '准备或上传失败，未调用生图',exc)})
        except Exception:pass
        raise

async def recover_jobs(st,lov,seen=None):
    seen=seen if seen is not None else {};jobs=(await call(st,'studio_recovery')).get('jobs',[]);provider_active=False
    for item in jobs:
        if not (item.get('task_ids') or (item.get('result') or {}).get('url')):continue
        if seen.get(item['id'],0)>time.monotonic():
            provider_active|=bool(item.get('task_ids')) and (item.get('result') or {}).get('status')!='completed'
            continue
        seen[item['id']]=time.monotonic()+15
        job=(await call(st,'studio_resume',{'job_id':item['id']}))['job']
        try:
            done=await follow_job(st,lov,job,wait=False)
            provider_active|=not done and bool(job.get('task_ids'))
        except Exception as exc:
            await call(st,'studio_progress',{'job_id':job['id'],'claim_id':job['claim_id'],'phase':'needs_review','message':failure_message('原任务查询或下载暂未成功，将继续核对',exc)})
            if isinstance(exc,MCPCallFailure):raise
            provider_active|=bool(job.get('task_ids')) and (job.get('result') or {}).get('status')!='completed'
    return provider_active

async def analysis_once(st,vision):
    analysis=(await call(st,'studio_analysis_claim')).get('analysis')
    if not analysis:return False
    ids={'analysis_id':analysis['id'],'claim_id':analysis['claim_id']}
    try:
        reference=await call(st,'studio_analysis_reference',ids)
        text=await asyncio.wait_for(vision(reference['local_path'],analysis['instruction']),90)
        if not isinstance(text,str) or not text.strip():raise ValueError('视觉工具未返回描述')
        from pose_observation import parse_observation
        observation=parse_observation(text)
        await call(st,'studio_analysis_complete',{**ids,'observation':observation,'vision_model':'unknown'})
    except asyncio.TimeoutError:
        await call(st,'studio_analysis_complete',{**ids,'error':'姿态识图超过90秒未返回，请检查Agent视觉连接后再决定是否重试；未调用生图工具。'})
    except Exception as exc:
        from platform_metadata import safe_platform_message
        message=safe_platform_message(str(exc),400) if isinstance(exc,ValueError) else failure_message('姿态识图失败，请检查Hermes视觉连接后重试',exc)
        await call(st,'studio_analysis_complete',{**ids,'error':message})
    return True

async def serve_tasks(st,lov,models,minutes=0,once=False):
    deadline=time.monotonic()+minutes*60 if minutes else None;last_beat=0;seen={}
    while deadline is None or time.monotonic()<deadline:
        if time.monotonic()-last_beat>=25:
            await call(st,'studio_heartbeat');last_beat=time.monotonic()
        if await recover_jobs(st,lov,seen):
            await asyncio.sleep(3);continue
        job=(await call(st,'studio_claim')).get('job')
        if job:
            try:await run_job(st,lov,job,{m['name']:m['schema'] for m in models})
            except Exception as exc:
                if isinstance(exc,MCPCallFailure):raise
                print(json.dumps({'job_id':job['id'],'action':'retained_without_retry','error_type':type(exc).__name__}),flush=True)
            if once:return
        else:await asyncio.sleep(3)

def arguments(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--execute',action='store_true');mode.add_argument('--check',action='store_true')
    parser.add_argument('--once',action='store_true');parser.add_argument('--minutes',type=int,default=0)
    parser.add_argument('--self-check',action='store_true');parser.add_argument('--mcp-args-json');parser.add_argument('--data',default=STUDIO_DATA);parser.add_argument('--mcp-command',default=STUDIO_CMD)
    args=parser.parse_args(argv)
    if args.minutes<0:parser.error('--minutes must be nonnegative')
    return args

def native_vision():
    try:
        from tools.vision_tools import check_video_requirements,vision_analyze_tool
        if not check_video_requirements():return None
    except Exception:return None
    async def analyze(path,instruction):
        # Use Hermes's existing auxiliary text-returning vision client. Its native
        # attachment-only fast path needs a chat model and is not a headless caption.
        raw=await vision_analyze_tool(path,instruction);result=json.loads(raw)
        if not result.get('success'):raise RuntimeError('Hermes视觉工具未成功')
        return result['analysis']
    return analyze

async def keepalive(st):
    while True:
        await call(st,'studio_heartbeat');await asyncio.sleep(25)

async def vision_loop(st,vision):
    while True:
        await analysis_once(st,vision);await asyncio.sleep(3)

async def supervise(st,lov,models,vision,minutes,once):
    work=asyncio.create_task(serve_tasks(st,lov,models,minutes,once))
    tasks=[work,asyncio.create_task(keepalive(st))]
    if vision:tasks.append(asyncio.create_task(vision_loop(st,vision)))
    try:
        done,_=await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
        for task in done:task.result() # propagate a dead heartbeat/vision worker
        if work not in done:raise RuntimeError('执行器后台流程意外结束，重新连接')
    finally:
        for task in tasks:task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)

async def connected_cycle(execute,minutes,once):
    global PLATFORM_TOOLS
    from hermes_cli.mcp_config import _get_mcp_servers
    from tools.mcp_tool import MCPServerTask
    from mcp import ClientSession,StdioServerParameters
    from mcp.client.stdio import stdio_client
    cfg=_get_mcp_servers().get('lovart')
    if not cfg:raise RuntimeError('E_CONFIG: 当前Hermes未配置Lovart')
    platform=MCPServerTask('lovart');tasks=[]
    try:
        async with stdio_client(StdioServerParameters(command=STUDIO_CMD,args=STUDIO_ARGS if STUDIO_ARGS is not None else ['--data',STUDIO_DATA])) as (reader,writer):
            async with ClientSession(reader,writer) as st:
                emit_event('connecting','正在连接本机工作台')
                await st.initialize();status=await call(st,'studio_status')
                if not status.get('enabled'):raise RuntimeError('E_DISABLED: 请在网页启用Agent')
                if 'lovart' not in status.get('platform','').lower():raise RuntimeError('E_CONFIG: 本机执行器只适配Lovart，其他平台请由相应Agent连接')
                emit_event('connecting','正在连接Hermes已配置的Lovart工具')
                await asyncio.wait_for(platform.start(cfg),45);lov=platform.session;emit_event('connecting','平台已连接，正在查询完整模型目录');PLATFORM_TOOLS={t.name for t in platform._tools}
                models,summary=await full_catalog(lov);vision=native_vision();capabilities=['pose_analysis'] if vision else []
                catalog_file=Path(STUDIO_DATA)/'executor-catalog.json';catalog_file.write_text(json.dumps({'models':models,'catalog_summary':summary},ensure_ascii=False))
                await call(st,'studio_register',{'agent_name':'Hermes','models':models,'catalog_summary':summary,'executor_capabilities':capabilities,'executor_instance_id':EXECUTOR_INSTANCE_ID});await call(st,'studio_heartbeat')
                recovery=await call(st,'studio_recovery')
                print(json.dumps({'mode':'execute' if execute else 'check_only','discovered':summary['discovered_count'],'registered':len(models),'excluded':summary['excluded'],'needs_recovery':len(recovery.get('jobs',[])),'executor_capabilities':capabilities},ensure_ascii=False),flush=True)
                emit_event('registered','连接已就绪，等待网页任务')
                if not execute:return
                await supervise(st,lov,models,vision,minutes,once)
    finally:
        with contextlib.suppress(Exception):await platform.shutdown()

def error_codes(exc):
    import re
    messages=[str(exc)]+[error_codes(e) for e in getattr(exc,'exceptions',[])]
    return ' '.join(re.findall(r'E_[A-Z_]+',' '.join(messages)))

def emit_event(code,message):
    print('STUDIO_EVENT '+json.dumps({'code':code,'message':message},ensure_ascii=False),flush=True)

def self_check():
    import importlib.util
    sys.path.insert(0,str(hermes_workspace()))
    required=['mcp','PIL','hermes_cli.mcp_config','tools.mcp_tool','tools.vision_tools']
    missing=[]
    for name in required:
        try:
            if importlib.util.find_spec(name) is None:missing.append(name)
        except (ImportError,ValueError,ModuleNotFoundError):missing.append(name)
    if missing:emit_event('E_DEPENDENCY','Python环境缺少运行依赖：'+', '.join(missing));return 24
    emit_event('checked','运行环境检查通过');return 0

async def main(execute=True,minutes=0,once=False):
    sys.path.insert(0,str(hermes_workspace()))
    # Complete Hermes runtime initialization before opening any persistent MCP session.
    import agent.process_bootstrap
    failures=0
    while True:
        try:return await connected_cycle(execute,minutes,once)
        except Exception as exc:
            codes=error_codes(exc)
            if not execute or once or any(c in codes for c in ['E_CONFIG','E_DISABLED','E_EXECUTOR_BUSY','E_SESSION_REPLACED']):raise
            failures+=1
            emit_event(codes or 'E_CONNECTION','连接中断，正在退避重连；已有任务只查询回收，不重新生成')
            # Let the supervisor apply its crash circuit breaker after bounded retries.
            if failures>=5:raise
            await asyncio.sleep(min(30,failures*3))

def acquire_managed_lease(root):
    root.mkdir(parents=True,exist_ok=True);file=(root/'managed-executor.lock').open('a+')
    deadline=time.monotonic()+8
    while True:
        try:
            if os.name=='nt':
                import msvcrt
                file.seek(0);file.write('0');file.flush();file.seek(0);msvcrt.locking(file.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(file.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            return file
        except OSError:
            if time.monotonic()>deadline:file.close();raise RuntimeError('E_EXECUTOR_BUSY')
            time.sleep(.2)

async def parent_watch():
    parent=int(os.environ['PORTRAIT_STUDIO_PARENT_PID'])
    while True:
        await asyncio.sleep(2)
        try:os.kill(parent,0)
        except ProcessLookupError:raise RuntimeError('E_PARENT_EXIT') from None
        except PermissionError:pass

async def run_with_parent(execute,minutes,once):
    if not os.environ.get('PORTRAIT_STUDIO_PARENT_PID'):return await main(execute,minutes,once)
    work=asyncio.create_task(main(execute,minutes,once));watch=asyncio.create_task(parent_watch())
    try:
        done,_=await asyncio.wait([work,watch],return_when=asyncio.FIRST_COMPLETED)
        for task in done:task.result()
    finally:
        for task in [work,watch]:task.cancel()
        await asyncio.gather(work,watch,return_exceptions=True)

if __name__=='__main__':
    args=arguments();STUDIO_DATA=str(Path(args.data).expanduser().resolve());STUDIO_CMD=args.mcp_command;STUDIO_ARGS=json.loads(args.mcp_args_json) if args.mcp_args_json else None;OUTDIR=Path(STUDIO_DATA)/'executor-results'
    if args.self_check:sys.exit(self_check())
    lease=None
    try:
        if os.environ.get('PORTRAIT_STUDIO_MANAGED_ID'):lease=acquire_managed_lease(Path(STUDIO_DATA))
        asyncio.run(run_with_parent(not args.check,args.minutes,args.once))
    except Exception as exc:
        codes=error_codes(exc)
        terminal=next((c for c in ['E_SESSION_REPLACED','E_EXECUTOR_BUSY','E_DISABLED','E_CONFIG','E_CONTRACT_UPGRADED','E_PARENT_EXIT'] if c in codes),None)
        messages={'E_SESSION_REPLACED':'执行器已被接替，已停止且不会抢占连接','E_EXECUTOR_BUSY':'另一个执行器仍在线，请先停止原执行器','E_DISABLED':'项目接入已停用，请在连接设置中授权','E_CONFIG':'Hermes未配置可用的Lovart连接，请在Hermes中完成平台连接','E_CONTRACT_UPGRADED':'接口版本不兼容，请更新执行器'}
        emit_event(terminal or codes or 'E_CONNECTION',messages.get(terminal,'执行器连接未完成，请检查Agent平台登录和网络；未重新生成旧任务'))
        sys.exit(22 if terminal else 1)
    finally:
        if lease:lease.close()
