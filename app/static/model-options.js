/* Use advertised pixel sizes for size-based models; never invent a 2K field. */
(function(root){
 const gcd=(a,b)=>b?gcd(b,a%b):a;
 const sizeRatio=s=>{const m=String(s).match(/^(\d+)[*x×](\d+)$/);if(!m)return 'default';const w=Number(m[1]),h=Number(m[2]),g=gcd(w,h);return `${w/g}:${h/g}`;};
 const forRatio=(sizes,ratio)=>sizes.filter(s=>sizeRatio(s)===ratio);
 const parameterMode=props=>{const ratios=props.aspect_ratio?.enum||[],resolutions=props.resolution?.enum||[],sizes=props.size?.enum||[];if(sizes.length&&!(ratios.length&&resolutions.length))return 'size';if(resolutions.length&&resolutions.every(v=>sizeRatio(v)!=='default'))return 'resolution-pixels';return 'standard';};
 const api={sizeRatio,forRatio,parameterMode};if(typeof module!=='undefined')module.exports=api;else root.ModelOptions=api;
})(typeof window==='undefined'?globalThis:window);
