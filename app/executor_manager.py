"""Workbench-owned, shell-free lifecycle for explicitly configured local adapters."""
import json,os,sys,time,uuid,threading,subprocess,signal,collections,re
from pathlib import Path
from platform_metadata import safe_platform_message

class ExecutorManager:
    def __init__(self,app,start_thread=True):
        self.app=app;self.root=app.store.root;self.path=self.root/'managed-executor.json';self.lock=threading.RLock();self.closed=False
        try:self.config=json.loads(self.path.read_text())
        except (OSError,ValueError):self.config={}
        self.desired=self.config.get('desired_running') is True;self.process=None;self.instance='';self.state='stopped';self.error='';self.error_code='';self.failures=collections.deque();self.next_try=0;self.started=0;self.restarts=0;self.events=collections.deque(maxlen=8)
        if start_thread:threading.Thread(target=self.loop,daemon=True).start()
    def entrypoint(self):
        folder=Path(__file__).resolve().parent
        return folder/('executor/hermes_executor.py' if getattr(sys,'frozen',False) else 'hermes_executor.py')
    def save(self):
        self.config['desired_running']=self.desired;temporary=self.path.with_suffix('.tmp');temporary.write_text(json.dumps(self.config,ensure_ascii=False,indent=2));os.replace(temporary,self.path)
    def env(self):
        env=dict(os.environ)
        # Avoid the frozen App's Python runtime environment leaking into external Python.
        for key in ['PYTHONHOME','PYTHONPATH','DYLD_LIBRARY_PATH','DYLD_FRAMEWORK_PATH','LD_LIBRARY_PATH'] :env.pop(key,None)
        if self.config.get('agent_home'):env['HERMES_HOME']=self.config['agent_home']
        env['PORTRAIT_STUDIO_MANAGED_ID']=self.instance
        env['PORTRAIT_STUDIO_PARENT_PID']=str(os.getpid())
        env['PYTHONUNBUFFERED']='1'
        env['PYTHONDONTWRITEBYTECODE']='1';return env
    def preflight(self):
        if not self.entrypoint().is_file():raise ValueError('执行器组件缺失，请完整重新安装工作台')
        try:r=subprocess.run([self.config['python'],str(self.entrypoint()),'--self-check'],env=self.env(),capture_output=True,text=True,timeout=20)
        except subprocess.TimeoutExpired:raise ValueError('运行环境检查超时，请检查Python环境') from None
        except OSError:raise ValueError('Python无法启动，请检查运行环境路径') from None
        if r.returncode:
            for line in r.stdout.splitlines():
                if line.startswith('STUDIO_EVENT '):
                    try:raise ValueError(safe_platform_message(json.loads(line[13:]).get('message','运行环境检查未通过'),400))
                    except json.JSONDecodeError:pass
            raise ValueError('运行环境检查未通过：请让Agent检查Python依赖或执行器组件')
        return {'ok':True}
    def configure(self,p):
        if set(p)-{'adapter','python','agent_home'}:raise ValueError('托管配置只接受适配器和运行环境路径，不接收凭据或任意命令')
        if p.get('adapter')!='hermes':raise ValueError('当前托管适配器为Hermes；其他Agent请使用外部MCP接入')
        python=Path(p.get('python','')).expanduser()
        if not re.fullmatch(r'python(?:[0-9]+(?:\.[0-9]+)*)?(?:\.exe)?',python.name,re.I):raise ValueError('请选择Python解释器，不接受其他程序或Shell命令')
        if not python.is_absolute() or not python.is_file() or (os.name!='nt' and not os.access(python,os.X_OK)):raise ValueError('Python运行环境路径不存在或不可执行')
        home=Path(p.get('agent_home') or Path.home()/'.hermes').expanduser()
        if not home.is_absolute() or not home.is_dir():raise ValueError('Agent工作目录不存在')
        with self.lock:
            if self.process and self.process.poll() is None:raise ValueError('请先停止托管执行器再修改运行环境')
            previous=dict(self.config);self.config={'adapter':'hermes','python':str(python),'agent_home':str(home)}
            try:self.preflight()
            except Exception:self.config=previous;raise
            self.desired=False;self.error='';self.error_code='';self.state='stopped';self.save()
        return self.info()
    def busy(self):
        with self.app.store.lock:
            return any(j['state'] in ['preparing','submitting','running','cancelling'] for j in self.app.store.jobs()) or self.app.store.db.execute("select 1 from analyses where state='running'").fetchone() is not None
    def start(self):
        with self.app.execution_lock,self.lock:
            if not self.config.get('python'):raise ValueError('请先配置托管运行环境')
            c=self.app.agent_channel
            if not c.settings.get('enabled'):raise ValueError('请先在网页授权项目给Agent')
            if 'lovart' not in c.settings.get('platform','').lower():raise ValueError('当前托管适配器只支持Lovart')
            if c.info().get('ready') and (not self.instance or c.executor_instance_id!=self.instance):raise ValueError('已有外部执行器在线，请先让原Agent停止执行器后再启动托管')
            if self.process and self.process.poll() is None:return self.info()
            self.preflight();self.desired=True;self.next_try=0;self.error='';self.error_code='';self.failures.clear();self.save();self._spawn()
        return self.info()
    def _spawn(self):
        self.instance=uuid.uuid4().hex;self.state='starting';self.started=time.time()
        server=self.app.agent_channel.configuration()['mcpServers']['portrait-studio']
        args=[self.config['python'],str(self.entrypoint()),'--data',str(self.root),'--mcp-command',server['command'],'--mcp-args-json',json.dumps(server['args']),'--minutes','0']
        options={'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP} if os.name=='nt' else {'start_new_session':True}
        try:self.process=subprocess.Popen(args,env=self.env(),stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1,**options)
        except OSError:self.state='failed';self.error='执行器无法启动，请检查Python路径';self.error_code='E_LAUNCH';self.desired=False;self.save();return
        threading.Thread(target=self.read_events,args=(self.process,),daemon=True).start()
    def read_events(self,process):
        try:
            for line in iter(process.stdout.readline,''):
                if not line.startswith('STUDIO_EVENT '):continue
                try:event=json.loads(line[13:])
                except (ValueError,TypeError):continue
                code=str(event.get('code',''))[:80];message=safe_platform_message(event.get('message',''),400)
                with self.lock:
                    if process is not self.process:continue
                    self.events.append({'time':time.time(),'code':code,'message':message})
                    if code not in ['registered','checked','connecting']:self.error=message;self.error_code=code
        finally:process.stdout.close()
    def _terminate(self):
        process=self.process
        if process and process.poll() is None:
            try:
                if os.name=='nt':process.terminate()
                else:os.killpg(process.pid,signal.SIGTERM)
                process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                if os.name=='nt':process.kill()
                else:os.killpg(process.pid,signal.SIGKILL)
                process.wait(timeout=3)
            except ProcessLookupError:pass
        self.process=None
        c=self.app.agent_channel
        if self.instance and c.executor_instance_id==self.instance:
            c.session=None;c.last_seen=0;self.app.status={'state':'disconnected','executor':'external','message':'托管执行器已停止'}
    def stop(self):
        with self.app.execution_lock,self.lock:
            if self.busy():raise ValueError('仍有生成或识图任务，请等待结束后再停止或重连')
            self.desired=False;self.save();self._terminate();self.state='stopped';self.error='';self.error_code=''
        return self.info()
    def reconnect(self):
        with self.app.execution_lock,self.lock:
            if self.busy():raise ValueError('仍有生成或识图任务，请等待结束后再重连')
            self._terminate();return self.start()
    def info(self):
        with self.lock:
            c=self.app.agent_channel;a=c.info();alive=self.process is not None and self.process.poll() is None;own=alive and c.executor_instance_id==self.instance
            state='unconfigured' if not self.config.get('python') else 'connected' if own and a.get('ready') else 'external' if a.get('ready') and not own else self.state
            return {'configured':bool(self.config.get('python')),'adapter':self.config.get('adapter','hermes'),'agent':'Hermes' if own or self.config.get('python') else a.get('agent','AGENT'),'state':state,'pid':self.process.pid if alive else None,'desired_running':self.desired,'last_seen':a.get('last_seen',0),'model_count':a.get('registered_model_count',0),'capabilities':a.get('executor_capabilities',[]),'error':self.error,'error_code':self.error_code,'restarts':self.restarts,'next_retry_at':self.next_try,'configuration':{k:self.config.get(k,'') for k in ['adapter','python','agent_home']},'events':list(self.events),'startup_with_workbench':self.desired}
    def tick(self):
        with self.lock:
            if self.closed or not self.desired:return
            c=self.app.agent_channel
            if not c.settings.get('enabled'):
                self.desired=False;self.save();self._terminate();self.state='stopped';self.error='项目授权已停用';return
            if self.process:
                code=self.process.poll()
                if code is None:
                    own=c.executor_instance_id==self.instance
                    if own and c.info().get('ready'):self.state='connected';self.error='';self.error_code=''
                    elif time.time()-self.started>120:
                        self.state='reconnecting'
                        if not self.busy():self._terminate();self.next_try=time.time()+3
                    return
                self.process=None
                if self.instance and c.executor_instance_id==self.instance:
                    c.session=None;c.last_seen=0;self.app.status={'state':'disconnected','executor':'external','message':'执行器恢复连接中'}
                # Never restart an executor which was explicitly replaced or denied ownership.
                if code==22:self.desired=False;self.save();self.state='failed';return
                now=time.time();self.failures.append(now)
                while self.failures and self.failures[0]<now-300:self.failures.popleft()
                self.error=self.error or '执行器意外退出，正在恢复连接';self.state='reconnecting'
                if len(self.failures)>=4:self.desired=False;self.save();self.state='failed';self.error='执行器连续启动失败，已停止自动重试。'+self.error;return
                self.next_try=now+min(20,2**len(self.failures));self.restarts+=1
            if time.time()<self.next_try:return
            if c.info().get('ready') and c.executor_instance_id!=self.instance:self.state='external';return
            self._spawn()
    def loop(self):
        while not self.app.stop.wait(1):
            try:self.tick()
            except Exception:
                with self.lock:self.state='failed';self.error='托管状态检查未完成，请检查运行环境后重连';self.desired=False;self.save()
        self.close()
    def close(self):
        with self.lock:
            if self.closed:return
            self.closed=True;self._terminate()
