"""Standard stdio MCP companion. The SDK owns framing, discovery and lifecycle."""
import argparse, base64, json, os, sys, uuid, urllib.request, urllib.error
from pathlib import Path
from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent, ImageContent
from runtime import data_dir,APP_ID

class StudioMCP(FastMCP):
    async def run_stdio_async(self):
        # The SDK's default wrapper owns sys.stdout.buffer. On frozen shutdown its
        # destructor closes that buffer before the bootloader flushes stdout.
        # Give the SDK duplicated descriptors, leaving process stdio ownership intact.
        import anyio
        from mcp.server.stdio import stdio_server
        reader=anyio.wrap_file(os.fdopen(os.dup(sys.stdin.fileno()),'r',encoding='utf-8'))
        writer=anyio.wrap_file(os.fdopen(os.dup(sys.stdout.fileno()),'w',encoding='utf-8'))
        try:
            async with stdio_server(stdin=reader,stdout=writer) as (read_stream,write_stream):
                await self._mcp_server.run(read_stream,write_stream,self._mcp_server.create_initialization_options())
        finally:
            await reader.aclose();await writer.aclose()

INSTRUCTIONS=''' AI Portrait Studio external executor, contract v3.
Connect the user's chosen platform MCP separately; never copy another Agent's login.
1. studio_status: verify the project and platform the user enabled in the WebUI.
2. List ALL available image models (follow pagination), describe EACH model and its actual parameter choices/capabilities. Never silently select just common models. Report each excluded model with its reason.
3. Declare edit based on actual image-to-image/edit modes, not only mask support. Identify your real Agent product in agent_name (Hermes, Claude Code, Codex, etc.); if unknown leave it empty, never invent an identity. This edition supports Lovart; other platforms are experimental user-owned adapters. studio_register with those choices and catalog_summary={discovered_count: total image models, excluded: [{name,reason}]}; discovered_count must equal registered+excluded. Do not invent models or claim untested platforms work.
4. A request to connect and use this studio means complete onboarding AND start a persistent execution loop immediately after registration. Do not stop at a connection report or wait for a second chat command. Keep the same MCP session, heartbeat every 30 seconds, claim every 3 seconds; an empty queue means wait, not exit. Only execute jobs the user submits in the WebUI; do not generate connection-test images. Actively poll studio_recovery, studio_resume and existing task IDs; do not only print a recovery count. Unresolved jobs without IDs remain for user review and do not block new jobs. Authorized projects are listed in authorized_project_ids; results always return to the job project.
5. Read only references in the claimed job; preserve prompt, reference order, model and dimensions.
6. If refs exist, call studio_reference with asset_id (NEVER reference_id) for EVERY refs item, use its workbench-prepared local_path (default conservative base64 budget 3700000; set the actual limit for other platforms), upload every image to the platform, preserve order. Do not recompress references yourself or substitute the source original for the upload copy. Any MCP isError/is_error, unreadable file, failed upload or missing URL/asset ID MUST STOP; never continue with fewer/no refs. BEFORE any paid call, studio_progress(phase='submitting', reference_uploads=[{asset_id,platform_reference}], submission={tool,arguments}) using the EXACT arguments you will send. Stop if this validation fails. Never call the platform before it succeeds. A WebUI generation click authorizes only that one queued job, not extra trials or a different platform.
7. Record platform project_id/edit_url/url with platform_result, and task_ids with running. Reuse that provider project for uploads/generation. A completed synchronous result with no task ID uses phase='result_ready' plus its real url. Poll slow jobs with no fixed retry-count cutoff. If studio_job.cancel_requested, request platform cancellation and only report cancelled with cancellation_confirmed=true after actual confirmation; pre-submit cancellation must prevent any generation. A clear failed/moderated result is failed, not an ambiguous submission.
8. Save the platform's actual full-resolution image to a local file, then studio_complete.
If you have actual vision capability register executor_capabilities=['pose_analysis'] and serve studio_analysis_claim/reference/complete; read pixels, follow the given instruction and return actual observations. Never call a generator for pose analysis.
Never generate again after an uncertain submission, disconnect, or needs_review. Use studio_resume and query existing tasks. If no task ID exists, ask the user to check the platform. Never label a preview/upscaled thumbnail as an original.
For a definitive platform failure report phase=failed, task_ids, message and platform_result={status:'failed',source,error:{code,message},result_ready:false}; failed is terminal and excluded from recovery, never auto-retry it. E_SESSION_REPLACED means stop this old executor immediately and do not re-register it. A fresh process must use its own executor_instance_id. Pose claims include result_format=pose_observation_v1: return the six observed groups and explicit unknown contacts through observation; pass actual vision_model if known, else unknown. Follow the per-claim instruction, do not invent missing visual facts to fill the schema. Serve pose analysis concurrently with generation, call a real text-returning vision tool with a bounded timeout, and complete with text or a concise error; do not wait for an unserviced answer file. A repeated studio_analysis_claim in the same session returns its outstanding claim, so a lost response can be recovered. Analysis results remain available to the user after the dialog closes.
Only report ready after the execution loop is actually running with heartbeats. If this Agent cannot sustain a loop, explain that concrete limitation and provide an appropriate local executor launch method. Keep running only while the Agent session/execution loop is active. If ending, tell the user the WebUI will wait for an executor. Do not claim permanent unattended operation.
'''

def make_server(root):
    root=Path(root).expanduser().resolve();session=uuid.uuid4().hex
    server=StudioMCP('AI Portrait Studio',instructions=INSTRUCTIONS)
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def invoke(tool,arguments=None):
        try:
            record=json.loads((root/'instance.json').read_text());port=record['port']
            if type(port)!=int or not 1024<=port<=65535:raise ValueError()
            url=f'http://127.0.0.1:{port}'
            with opener.open(url+'/api/health',timeout=3) as response:health=json.load(response)
            if health.get('app_id')!=APP_ID or health.get('pid')!=record['pid']:raise ValueError()
            token=(root/'agent-access.key').read_text().strip()
        except (OSError,ValueError,KeyError):raise ValueError('E_NOT_READY: 请打开新版工作台，并在连接设置中启用当前项目的 Agent 接入') from None
        payload={'tool':tool,'arguments':{**(arguments or {}),'session':session}}
        request=urllib.request.Request(url+'/api/agent/v1/call',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-Studio-Token':token})
        try:
            with opener.open(request,timeout=30) as response:return json.load(response)
        except urllib.error.HTTPError as e:
            try:message=json.load(e)
            finally:e.close()
            raise ValueError(str(message.get('code','E_HTTP'))+': '+str(message.get('error','操作未完成'))) from None
        except OSError:raise ValueError('E_CONNECTION: 工作台连接中断；已提交任务不可自动重试生图') from None
    @server.tool()
    def studio_status()->dict:
        """Read only the project/platform explicitly enabled by the WebUI user."""
        result=invoke('studio_status');result.pop('configuration',None);return result
    @server.tool()
    def studio_register(models:list[dict],catalog_summary:dict,agent_name:str='',executor_capabilities:list[str]|None=None,executor_instance_id:str='')->dict:
        """Register the FULL actual image-model catalog, not a hand-picked subset. Each model has name, display_name, object schema, capabilities [generate, references?, edit?]. catalog_summary={discovered_count:int,excluded:[{name,reason}]}; counts must reconcile. No generation."""
        params=server.get_context().session.client_params
        client_name=params.clientInfo.name if params else ''
        return invoke('studio_register',{'agent_name':agent_name,'client_name':client_name,'models':models,'catalog_summary':catalog_summary,'executor_capabilities':executor_capabilities or [],'executor_instance_id':executor_instance_id})
    @server.tool()
    def studio_heartbeat()->dict:
        """Keep the executor visible as online; call at least every 30 seconds while running."""
        return invoke('studio_heartbeat')
    @server.tool()
    def studio_claim()->dict:
        """Atomically claim one user-submitted job. Never submit a new platform task without first marking submitting."""
        return invoke('studio_claim')
    @server.tool()
    def studio_job(job_id:str,claim_id:str)->dict:
        """Read a claimed job's state, prompt, reference identifiers and platform task IDs."""
        return invoke('studio_job',{'job_id':job_id,'claim_id':claim_id})
    @server.tool()
    def studio_resume(job_id:str)->dict:
        """Resume recovery of an interrupted job. Query existing platform tasks ONLY; this never authorizes another generation."""
        return invoke('studio_resume',{'job_id':job_id})
    @server.tool()
    def studio_recovery()->dict:
        """List incomplete jobs for the authorized project which need recovery of existing results."""
        return invoke('studio_recovery')
    @server.tool()
    def studio_reference(job_id:str,claim_id:str,asset_id:str,max_base64_chars:int=3_700_000)->list:
        """Read a claimed job reference as a platform-ready upload copy. Default conservative base64 budget 3700000 chars (below Lovart 8MB; allows MCP transport overhead). For another platform supply its actual max_base64_chars. Use returned local_path and filename directly; do not recompress or read the original instead. upload metadata states dimensions/bytes/transform; original is preserved. Reading does not authorize unrelated uploads."""
        r=invoke('studio_reference',{'job_id':job_id,'claim_id':claim_id,'asset_id':asset_id,'max_base64_chars':max_base64_chars})
        from PIL import Image
        import io
        raw=base64.b64decode(r['base64']);im=Image.open(io.BytesIO(raw));fmt=im.format.lower();ext={'jpeg':'.jpg','png':'.png','webp':'.webp'}[fmt]
        return [TextContent(type='text',text=json.dumps({'local_path':r['local_path'],'filename':Path(r['local_path']).name,'name':r['name'],'sha256':r['sha256'],'upload':r['upload']})),ImageContent(type='image',data=r['base64'],mimeType='image/'+fmt)]
    @server.tool()
    def studio_progress(job_id:str,claim_id:str,phase:str,task_ids:list[str]|None=None,message:str='',reference_uploads:list[dict]|None=None,submission:dict|None=None,platform_result:dict|None=None,cancellation_confirmed:bool=False)->dict:
        """Before submitting, read/upload ALL refs. reference_uploads=[{asset_id,platform_reference}] in refs order; submission={tool,arguments} must contain those exact platform references. Reject/STOP on missing refs or any MCP error. Only after success call that platform tool with those exact arguments. Then report running/task_ids or needs_review/failed; never resubmit uncertain tasks."""
        return invoke('studio_progress',{'job_id':job_id,'claim_id':claim_id,'phase':phase,'task_ids':task_ids or [],'message':message,'reference_uploads':reference_uploads,'submission':submission,'platform_result':platform_result,'cancellation_confirmed':cancellation_confirmed})
    @server.tool()
    def studio_complete(job_id:str,claim_id:str,local_path:str,platform_result:dict|None=None)->dict:
        """Import an actual full-resolution local PNG/JPEG/WebP, up to 100MiB. The companion sends only a path and SHA256; no large base64 over MCP. Validated inside the authorized job, idempotent for identical bytes. platform_result may include project_id/edit_url/url/model/size/width/height. Never import a preview as an original."""
        import hashlib
        path=Path(local_path).expanduser()
        if not path.is_absolute() or not path.is_file() or path.stat().st_size>100*1024*1024:raise ValueError('E_IMAGE: 请提供100MiB以内原图的绝对本机路径')
        with path.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
        return invoke('studio_complete',{'job_id':job_id,'claim_id':claim_id,'local_path':str(path.resolve()),'expected_sha256':digest,'platform_result':platform_result})
    @server.tool()
    def studio_analysis_claim()->dict:
        """Claim a user-clicked pose analysis, only if this executor registered pose_analysis vision capability. No image generation. Use instruction, reference and analysis_complete to fill the user's editable pose draft."""
        return invoke('studio_analysis_claim')
    @server.tool()
    def studio_analysis_reference(analysis_id:str,claim_id:str)->list:
        """Read only the claimed pose-analysis image as pixels and local_path. Analyze using your existing vision capability; never use an image generator to invent a pose."""
        r=invoke('studio_analysis_reference',{'analysis_id':analysis_id,'claim_id':claim_id})
        from PIL import Image
        import io
        fmt=Image.open(io.BytesIO(base64.b64decode(r['base64']))).format.lower()
        return [TextContent(type='text',text=json.dumps({'local_path':r['local_path'],'sha256':r['sha256'],'name':r['name']})),ImageContent(type='image',data=r['base64'],mimeType='image/'+fmt)]
    @server.tool()
    def studio_analysis_complete(analysis_id:str,claim_id:str,text:str='',error:str='',observation:dict|None=None,vision_model:str='unknown')->dict:
        """Return observation per the claimed result_format (summary, six observations, uncertainties), plus the actual vision_model if known, else unknown. The Agent may normalize model output but must not invent visual facts. Legacy text is accepted and labeled unverified format; errors use error. The WebUI fills the editable draft, never auto-saves it as a preset. Read the image first and retain uncertainty/occlusion."""
        return invoke('studio_analysis_complete',{'analysis_id':analysis_id,'claim_id':claim_id,'text':text,'error':error,'observation':observation,'vision_model':vision_model})
    return server

def main():
    parser=argparse.ArgumentParser(description='AI Portrait Studio stdio MCP');parser.add_argument('--data',type=Path,default=None);args=parser.parse_args()
    make_server(args.data or data_dir()).run(transport='stdio')
if __name__=='__main__':main()
