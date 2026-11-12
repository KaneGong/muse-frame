// Local pixel adjustments, based on the previous app/retouch.py tone pipeline.
// Spatial filters use separable box blurs; output is not claimed bit-identical to Pillow.
export const ADJUSTMENTS=[['exposure','曝光',-2,2,.1],['contrast','对比度',-50,50,1],['highlights','高光',-50,50,1],['shadows','阴影',-50,50,1],['whites','白色阶',-50,50,1],['blacks','黑色阶',-50,50,1],['warmth','冷暖',-50,50,1],['tint','色偏（绿 ↔ 品红）',-100,100,1],['saturation','饱和度',-50,50,1],['clarity','清晰度',-50,50,1],['texture','纹理',-50,50,1],['sharpness','锐度',0,100,1]].map(([id,label,min,max,step])=>({id,label,min,max,step}));
export const defaultAdjustments=()=>Object.fromEntries(ADJUSTMENTS.map(x=>[x.id,0]));
export function normalizeAdjustments(settings={}){
 const result=defaultAdjustments();
 for(const [key,value] of Object.entries(settings)){
  const item=ADJUSTMENTS.find(x=>x.id===key);
  if(!item||typeof value!=='number'||!Number.isFinite(value)||value<item.min||value>item.max)throw Error('修图参数无效：'+key);
  result[key]=value;
 }
 return result;
}
const clamp=x=>Math.max(0,Math.min(255,x));
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function blur(src,w,h,r){
 r=Math.max(1,Math.min(Math.round(r),Math.max(w,h)));const tmp=new Float32Array(src.length),out=new Float32Array(src.length),d=2*r+1;
 for(let y=0;y<h;y++){let sum=0;for(let k=-r;k<=r;k++)sum+=src[y*w+Math.max(0,Math.min(w-1,k))];for(let x=0;x<w;x++){tmp[y*w+x]=sum/d;sum+=src[y*w+Math.min(w-1,x+r+1)]-src[y*w+Math.max(0,x-r)];}}
 for(let x=0;x<w;x++){let sum=0;for(let k=-r;k<=r;k++)sum+=tmp[Math.max(0,Math.min(h-1,k))*w+x];for(let y=0;y<h;y++){out[y*w+x]=sum/d;sum+=tmp[Math.min(h-1,y+r+1)*w+x]-tmp[Math.max(0,y-r)*w+x];}}
 return out;
}
export function applyAdjustments(image,settings={}){
 const p=normalizeAdjustments(settings),{width:w,height:h}=image;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>60000000||image.data?.length!==w*h*4)throw Error('图片尺寸无效或超过6000万像素');
 const data=new Uint8ClampedArray(image.data),n=w*h;
 if(!Object.values(p).some(Boolean))return {data,width:w,height:h};
 const lum=new Float32Array(n);let mean=0;
 const tables=[1+p.warmth*.003+p.tint*.0015,1-2*p.tint*.0015,1-p.warmth*.003+p.tint*.0015].map(gain=>Float32Array.from({length:256},(_,i)=>{const s=i/255,l=(s<=.04045?s/12.92:((s+.055)/1.055)**2.4)*2**p.exposure*gain;return clamp(255*(l<=.0031308?l*12.92:1.055*l**(1/2.4)-.055));}));
 for(let i=0;i<n;i++){const k=i*4;lum[i]=image.data[k]*.299+image.data[k+1]*.587+image.data[k+2]*.114;for(let c=0;c<3;c++)data[k+c]=tables[c][data[k+c]];mean+=data[k]*.299+data[k+1]*.587+data[k+2]*.114;}mean/=n;
 for(let i=0;i<n;i++){const k=i*4;for(let c=0;c<3;c++)data[k+c]=clamp(mean+(data[k+c]-mean)*(1+p.contrast/100));const gray=data[k]*.299+data[k+1]*.587+data[k+2]*.114;for(let c=0;c<3;c++)data[k+c]=clamp(gray+(data[k+c]-gray)*(1+p.saturation/100));const x=(data[k]*.299+data[k+1]*.587+data[k+2]*.114)/255;const delta=255*(p.highlights/100*.25*smooth(.45,1,x)+p.shadows/100*.30*(1-smooth(.05,.65,x))*smooth(0,.12,x)+p.whites/100*.22*smooth(.70,1,x)+p.blacks/100*.18*(1-smooth(0,.30,x)));for(let c=0;c<3;c++)data[k+c]=clamp(data[k+c]+delta);}
 for(const [key,radius,gain] of [['clarity',Math.min(w,h)*.015,.012],['texture',Math.min(w,h)*.002,.01]]){
  if(!p[key])continue;const low=blur(lum,w,h,radius);
  for(let i=0;i<n;i++){const k=i*4,x=(data[k]*.299+data[k+1]*.587+data[k+2]*.114)/255,diff=lum[i]-low[i],d=Math.abs(diff)>1?diff*p[key]*gain*Math.sqrt(4*x*(1-x)):0;for(let c=0;c<3;c++)data[k+c]=clamp(data[k+c]+d);}
 }
 if(p.sharpness){const before=new Uint8ClampedArray(data);for(let c=0;c<3;c++){const channel=Float32Array.from({length:n},(_,i)=>before[i*4+c]),low=blur(channel,w,h,Math.max(.6,Math.min(w,h)*.0006));for(let i=0;i<n;i++){const diff=channel[i]-low[i];if(Math.abs(diff)>2)data[i*4+c]=clamp(channel[i]+diff*p.sharpness*.015);}}}
 return {data,width:w,height:h};
}
