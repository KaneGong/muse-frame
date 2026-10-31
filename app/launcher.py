"""Single-instance local WebUI launcher; source and frozen builds share this entry."""
import argparse,json,logging,os,socket,sys,threading,time,urllib.request,webbrowser,html
from pathlib import Path
from http.server import ThreadingHTTPServer
from socketserver import TCPServer
from runtime import APP_ID,APP_NAME,VERSION,DEFAULT_PORT,data_dir,diagnostics

class InstanceLock:
    def __init__(self,root):self.path=root/'instance.json';self.file=None
    def acquire(self):
        self.file=self.path.open('a+',encoding='utf-8')
        try:
            if os.name=='nt':
                import msvcrt
                self.file.seek(0);msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            return True
        except OSError:self.file.close();self.file=None;return False
    def write(self,port):
        self.file.seek(0);self.file.truncate();json.dump({'app_id':APP_ID,'pid':os.getpid(),'port':port},self.file);self.file.flush()
    def release(self):
        if self.file:self.file.close();self.file=None

def existing_instance(root,timeout=5):
    # A second click may arrive between acquiring the lock and writing readiness.
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        try:
            record=json.loads((root/'instance.json').read_text());port=record['port']
            if type(port)!=int or not 1024<=port<=65535:raise ValueError('invalid port')
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f'http://127.0.0.1:{port}/api/health',timeout=.4) as r:health=json.load(r)
            if health.get('app_id')==APP_ID and health.get('pid')==record['pid']:return port
        except (OSError,ValueError,KeyError):pass
        time.sleep(.1)
    return None

class LoopbackHTTPServer(ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer's default getfqdn() can block on reverse DNS. This service
        # listens only on numeric loopback and does not need a resolved hostname.
        TCPServer.server_bind(self)
        self.server_name='localhost'
        self.server_port=self.server_address[1]

def bind_server(port,handler):
    for candidate in range(port,min(port+20,65536)):
        try:return LoopbackHTTPServer(('127.0.0.1',candidate),handler)
        except OSError as e:
            if e.errno not in [48,98,10048]:raise
    raise RuntimeError('启动端口均被占用，请关闭旧实例后重试。')

def main(argv=None):
    parser=argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument('--data',type=Path,default=None);parser.add_argument('--port',type=int,default=DEFAULT_PORT)
    parser.add_argument('--no-browser',action='store_true');parser.add_argument('--connect',action='store_true')
    parser.add_argument('--doctor',action='store_true');args=parser.parse_args(argv)
    if args.doctor:print(json.dumps(diagnostics(),ensure_ascii=False,indent=2));return 0
    if not 1024<=args.port<=65535:parser.error('端口需要在1024至65535之间')
    root=(args.data or data_dir()).expanduser().resolve();root.mkdir(parents=True,exist_ok=True)
    (root/'logs').mkdir(exist_ok=True);logging.basicConfig(filename=root/'logs/startup.log',level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    lock=InstanceLock(root)
    if not lock.acquire():
        port=existing_instance(root)
        if port:
            if not args.no_browser:webbrowser.open(f'http://127.0.0.1:{port}/')
            return 0
        raise RuntimeError('程序正在启动或退出，请稍后再双击启动。')
    app=None;server=None
    try:
        from server import App,Handler
        server=bind_server(args.port,Handler);app=App(root);server.app=app;lock.write(server.server_port)
        if args.connect and not app.agent_channel.settings.get('enabled'):app.connect()
        logging.info('Started %s %s on loopback port %s',APP_ID,VERSION,server.server_port)
        if not args.no_browser:
            threading.Timer(.3,lambda:webbrowser.open(f'http://127.0.0.1:{server.server_port}/')).start()
        server.serve_forever(poll_interval=.2);return 0
    finally:
        if app:app.stop.set();app.executor_manager.close();app.bridge.close()
        if server:server.server_close()
        lock.release();logging.info('Stopped')

def entry():
    try:return main()
    except KeyboardInterrupt:return 0
    except Exception as e:
        logging.exception('Startup failed')
        # A frozen windowed program has no console. Show a local, actionable error page.
        if getattr(sys,'frozen',False):
            root=data_dir();root.mkdir(parents=True,exist_ok=True);page=root/'startup-error.html'
            page.write_text('<meta charset="utf-8"><title>'+APP_NAME+'</title><h1>启动未完成</h1><p>'+html.escape(str(e))+'</p><p>请重新启动；若仍有问题，联系维护者并提供启动日志，勿提供账号凭据。</p>',encoding='utf-8');webbrowser.open(page.as_uri())
        elif sys.stderr:print('启动未完成：'+str(e),file=sys.stderr)
        return 1

if __name__=='__main__':sys.exit(entry())
