"""Codex app-server transport: uses host-managed MCP auth, never reads credentials."""
import json, subprocess, threading, queue, time, tomllib, shutil
from pathlib import Path
from connections import find_codex

class CodexBridge:
    def __init__(self, cwd):
        self.cwd=str(cwd);self.lock=threading.RLock();self.proc=None;self.seq=0;self.thread_id=None;self.tools={}
    def connect(self):
        with self.lock:
            if self.proc and self.proc.poll() is None and self.thread_id:return
            args=[find_codex() or 'codex','app-server','--stdio']
            config=Path.home()/'.codex/config.toml'
            if config.exists():
                for name in tomllib.loads(config.read_text()).get('mcp_servers',{}):
                    if name!='lovart':args+=['-c',f'mcp_servers.{name}.enabled=false']
            self.proc=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
            self.inbox=queue.Queue();threading.Thread(target=self._read,args=(self.proc,self.inbox),daemon=True).start()
            self._rpc('initialize',{'clientInfo':{'name':'qujing-workbench','version':'0.1.0'},'capabilities':{'experimentalApi':True}})
            self.proc.stdin.write('{"method":"initialized"}\n');self.proc.stdin.flush()
            r=self._rpc('thread/start',{'ephemeral':True,'cwd':self.cwd,'approvalPolicy':'on-request'})
            self.thread_id=r['thread']['id']
            for _ in range(20):
                r=self._rpc('mcpServerStatus/list',{'threadId':self.thread_id})
                server=next((s for s in r.get('data',[]) if s.get('name')=='lovart'),{})
                if server.get('tools'):
                    self.tools=server['tools'];return
                time.sleep(1)
            raise RuntimeError('Codex 中的 Lovart 工具未就绪，请检查现有登录连接。')
    @staticmethod
    def _read(proc,inbox):
        try:
            for line in proc.stdout:
                try:inbox.put(json.loads(line))
                except ValueError:pass
        finally:inbox.put({'transport_closed':True})
    def _rpc(self,method,params,timeout=180):
        self.seq+=1;seq=self.seq
        self.proc.stdin.write(json.dumps({'id':seq,'method':method,'params':params})+'\n');self.proc.stdin.flush()
        end=time.monotonic()+timeout
        while True:
            try:r=self.inbox.get(timeout=max(.01,end-time.monotonic()))
            except queue.Empty:raise TimeoutError('Codex 工具连接超时；已提交的生成不会自动重新提交。')
            if r.get('transport_closed'):raise RuntimeError('Codex 工具连接已断开。')
            if r.get('id')==seq and ('result' in r or 'error' in r):
                if 'error' in r:raise RuntimeError(str(r['error'].get('message','工具调用失败')))
                return r['result']
            # Requests for login, approvals or other interactive input cannot be silently approved.
            if 'id' in r and 'method' in r:
                self.proc.stdin.write(json.dumps({'id':r['id'],'error':{'code':-32000,'message':'请在 Codex 中处理此交互；操作台不会自动批准。'}})+'\n');self.proc.stdin.flush()
    def call(self,name,args):
        with self.lock:
            self.connect()
            if name not in self.tools:raise RuntimeError('当前 Lovart 连接缺少工具：'+name)
            return self._rpc('mcpServer/tool/call',{'threadId':self.thread_id,'server':'lovart','tool':name,'arguments':args})
    def close(self):
        if self.proc and self.proc.poll() is None:self.proc.terminate()
        self.thread_id=None

def structured(result):
    if result.get('isError'):raise RuntimeError('Lovart 返回错误：'+str([x.get('text','') for x in result.get('content',[]) if x.get('type')=='text'])[:800])
    if result.get('structuredContent') is not None:return result['structuredContent']
    for c in result.get('content',[]):
        if c.get('type')=='text':
            try:return json.loads(c['text'])
            except (ValueError,KeyError):pass
    raise RuntimeError('Lovart 返回内容无法识别。')
