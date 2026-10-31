"""Face reference catalog: author-hosted thumbnails and user-selected originals."""
import base64,json,re,threading,urllib.request
SITE='https://ai-portrait-gallery.pages.dev/'
_cache=None
_lock=threading.RLock()
def catalog():
 global _cache
 with _lock:
  if _cache is None:
   try:
    req=urllib.request.Request(SITE+'data/images.js',headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(req,timeout=20) as response: text=response.read(2*1024*1024).decode('utf-8')
    raw=json.loads(text[text.index('['):text.rindex(']')+1]);items=[]
    for item in raw:
     cid=item.get('id','')
     if not re.fullmatch(r'[a-zA-Z0-9]{1,40}',cid):continue
     if item.get('section') not in ('face','styling'):continue
     items.append({'id':cid,'section':item['section'],'hair':item.get('hair',''),'style':item.get('style',''),'thumb':SITE+'img/thumb/'+cid+'.webp'})
    if not items:raise ValueError('empty catalog')
    _cache=items
   except Exception as e:raise ValueError('脸部参考库暂时无法读取，请检查网络后重试') from e
  return {'items':_cache,'source':SITE,'count':len(_cache)}
def import_image(app,pid,cid):
 if not isinstance(cid,str) or not re.fullmatch(r'[a-zA-Z0-9]{1,40}',cid):raise ValueError('脸部参考编号无效')
 item=next((i for i in catalog()['items'] if i['id']==cid),None)
 if item is None:raise ValueError('脸部参考不存在')
 if app.store.project(pid)['status']!='active':raise ValueError('请先恢复项目')
 with app.store.lock:
  existing=next((a for a in app.store.assets(pid) if a.get('face_gallery_id')==cid and not a.get('trashed')),None)
 if existing:return existing
 try:
  req=urllib.request.Request(SITE+'img/full/'+cid+'.png',headers={'User-Agent':'Mozilla/5.0'})
  with urllib.request.urlopen(req,timeout=30) as response:raw=response.read(16*1024*1024+1)
 except Exception as e:raise ValueError('原图下载失败，请检查网络后重试') from e
 with app.store.lock:
  existing=next((a for a in app.store.assets(pid) if a.get('face_gallery_id')==cid and not a.get('trashed')),None)
  if existing:return existing
  a=app.upload('脸部参考 '+cid,'face',base64.b64encode(raw).decode(),pid)
  record=app.store.asset(a['id']);record['face_gallery_id']=cid;record['face_gallery_source']=SITE
  app.store.put_asset(record)
  return app.store.asset(a['id'],pid)
