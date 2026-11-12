/* Reusable scene descriptions. No reference image or paid call is required to use text. */
(function(root){
const engine=typeof module!=='undefined'?require('./prompt-engine.js'):root.PromptEngine;
const presets=[
 {id:'cafe',name:'咖啡馆窗边',category:'室内',summary:'自然窗光、浅木桌与靠窗座位，轻松日常。',prompt:'安静的现代咖啡馆窗边，浅色木质小桌与线条简洁的座椅，柔和日光进入室内，背景保留少量生活细节和自然空间层次'},
 {id:'bistro',name:'现代简约餐厅',category:'室内',summary:'通透布局、简洁桌椅与柔和照明，适合坐姿。',prompt:'现代简约餐厅，通透的开放式布局、线条简洁的桌椅与柔和均匀的照明，公共通道和桌边留有活动空间，背景干净且有前后层次'},
 {id:'window-living',name:'落地窗起居室',category:'室内',summary:'整面落地窗、轻盈座区与远景，明亮通透。',prompt:'现代落地窗起居室，整面落地窗引入柔和日光，低矮沙发与简洁边几围合出轻盈座区，窗外城市或自然景色形成远景，室内保留完整站姿、坐姿与行走空间'},
 {id:'bookshop',name:'现代书店咖啡区',category:'室内',summary:'开放书架、阅读桌与咖啡座位，明亮安静。',prompt:'现代书店内的咖啡阅读区，开放式书架、简洁阅读桌与咖啡座位，采光柔和明亮，书籍陈列整齐但不过度均一，过道与座位之间保留自然空间层次'},
 {id:'gallery-corridor',name:'现代美术馆长廊',category:'室内',summary:'连续展墙、纵深廊道与克制光线，适合全身构图。',prompt:'现代美术馆长廊，连续留白展墙与开阔廊道形成清晰纵深，少量无文字艺术作品保持克制，顶部柔光与远端自然光衔接，留出完整站姿和行走空间'},
 {id:'minimal-stairs',name:'极简楼梯空间',category:'室内',summary:'干净折线、转角平台与柔和采光，空间层次清晰。',prompt:'极简楼梯空间，干净的几何折线连接不同高度，转角平台可作为坐姿或半身机位，柔和侧光勾勒踏步与墙面的层次，通行区域完整，构图通透不拥挤'},
 {id:'white-studio',name:'自然光白色影棚',category:'影棚',summary:'白色背景与基础方台，专注人物和服装。',prompt:'有大窗自然光的白色摄影棚，白色无缝背景、浅色地面与一个简洁坐台，环境干净，保留真实光影和足够的拍摄距离'},
 {id:'grey-studio',name:'深灰质感影棚',category:'影棚',summary:'灰色肌理背景与低凳，适合光影塑形。',prompt:'深灰色人像摄影棚，细腻灰色肌理背景、哑光地面与一个简洁低凳，布景克制，背景和人物位置之间留出层次与拍摄空间'},
 {id:'street',name:'城市街角',category:'户外',summary:'石材立面、橱窗与街道纵深，适合站姿或行走。',prompt:'安静的城市街角，浅色石材建筑立面、简洁橱窗与步行道，背景有自然街道纵深，避开拥挤人流和醒目标语'},
 {id:'park',name:'林荫公园',category:'户外',summary:'树影、步道与木长椅，自然轻盈。',prompt:'有生活气息的林荫公园，树木形成柔和树影，步道旁有木质长椅和低矮绿植，人物活动区域开阔，前后景自然分层'},
 {id:'coast',name:'海边步道',category:'户外',summary:'海面、地平线与浅色步道，开阔通透。',prompt:'安静开阔的海边步道，远处海面与清晰地平线，浅色石材步道和低矮挡墙，保留自然海风感与完整人物的拍摄空间'},
 {id:'rooftop',name:'城市屋顶露台',category:'户外',summary:'远处天际线、低墙与露台座椅，松弛都市感。',prompt:'城市建筑的屋顶露台，远处天际线作为背景，低矮围墙、简洁露台座椅和少量盆栽，空间干净开阔，具有真实都市生活感'},
 {"id":"vintage-apartment","name":"复古公寓","category":"室内","summary":"旧木地板、拱门与扶手椅，前后空间分开。","prompt":"旧木地板、拱门和有使用痕迹的扶手椅，走廊通向明亮房间；窗口、椅面和前景门框互相分开"},
 {"id":"hotel-window","name":"酒店窗边","category":"室内","summary":"通高窗、布帘与独立座位，动线开阔。","prompt":"通高窗、窗边单椅和简洁布帘，座位旁有小几，房间深处保持开阔通道，玻璃反射符合室内结构"},
 {"id":"record-shop","name":"唱片店","category":"室内","summary":"低矮唱片柜和通街玻璃，保留店内纵深。","prompt":"低矮唱片柜沿两侧布置，入口玻璃透向街面，中间保留可通行的纵深，店内层架与柜台位置稳定"},
 {"id":"arcade-street","name":"老街骑楼","category":"户外","summary":"沿街柱廊、木门与石阶，适合街拍。","prompt":"连续柱廊沿街道延伸，店面有木门与石阶，柱间可站可走；保持砖墙、立柱与街面透视连贯"},
 {"id":"brick-alley","name":"砖墙小巷","category":"户外","summary":"墙角形成前景，深处有连续步行空间。","prompt":"两侧砖墙和窗洞把视线引向街巷尽头，近处有墙角遮挡，中段有可倚靠的矮台，步行空间连续"},
 {"id":"subway-entry","name":"地铁入口","category":"户外","summary":"阶梯、扶手、雨棚与入口侧平台。","prompt":"露天入口的台阶、扶手与雨棚连接街面，入口侧平台留出驻足位置，台阶尺度和护栏连接合理"},
 {"id":"newsstand","name":"街边报刊亭","category":"户外","summary":"刊架和遮棚形成街角层次，步行区完整。","prompt":"小型报刊亭靠近街角，一侧露出刊架与遮棚，旁边有完整人行区，深处是街树和店面"},
 {"id":"hill-tree","name":"草坡与孤树","category":"户外","summary":"低坡、树影和远处地平线，环境开阔。","prompt":"缓坡连向一棵成熟树，坡脚保留平缓站位，近草、树影和远处地平线分层，地形起伏自然"},
 {"id":"lake-pier","name":"湖边木栈桥","category":"户外","summary":"平静水面、木栈桥和岸边长凳。","prompt":"木栈桥从岸边伸向静水，桥面足够行走，岸边有长凳，水面倒影与两侧树线对应"},
 {"id":"reed-path","name":"湿地芦苇径","category":"户外","summary":"芦苇是前景，木径和浅水保留纵深。","prompt":"窄木径穿过芦苇与浅水，设一个加宽停步点，芦苇前景不会封死通路，远处水域保持开阔"},
 {"id":"glass-conservatory","name":"玻璃温室","category":"室内","summary":"透明顶棚、植栽与中轴步道。","prompt":"透明顶棚和金属框架包围植栽，中央路径连续，侧边有长椅与可用空地，玻璃反射与构架一致"},
 {"id":"concrete-courtyard","name":"清水混凝土中庭","category":"影棚","summary":"柱列、低石台与开阔中庭，适合建筑感人像。","prompt":"清水混凝土柱列围住开放中庭，低石台和阶梯提供可用支撑，近柱、中庭和远墙形成清晰透视"}
];
function referencePrompt(p){return `你是一位资深的人像摄影师，同时也是场景设计师。根据下面的环境设定，设计一处适合开展一组人像摄影的真实场所，并制作一张无人环境多镜头参考板。\n\n环境设定：${p.prompt}\n\n先规划同一场所的连贯空间关系，再安排六个具有不同拍摄用途的镜头：\n1. 主全景：交代整体环境、主要通道和可拍摄区域。\n2. 全身机位：留出站姿或行走所需的完整空间，主体区域不被前景杂物遮挡。\n3. 坐姿机位：根据该场所安排合理的座椅、低台或可坐位置，完整容纳人物与腿脚，并有自然的支撑关系。\n4. 半身机位：选择具有背景层次、适合人物近距离拍摄的位置。\n5. 侧向机位：通过换机位展示同一空间的另一层次，不重复相似全景。\n6. 同一坐姿区域的另一拍摄角度：保持座位、建筑和主要物件位置一致，体现换角度后的拍摄可能性。\n\n所有镜头属于同一处场所，建筑、家具、材质与空间关系连贯。根据环境合理补全细节，保留自然生活感；所有画面以之后能够放入人物拍摄为目的，不安排与人物拍摄无关的材质、器材或装饰特写。\n\n一张环境参考板，主全景较大，其余五个机位分区清楚地排列，镜头之间不拼接物体。保持真实摄影质感、合理透视与自然材质，不做CG建筑效果图。\n\n全部为无人环境，不出现人物、人体局部、模特、人台或镜中人影。不添加标题、编号、装饰文字或水印。`;}
function textOnly(d,p){const next=structuredClone(d);next.draft=engine.environment(engine.patch(next.draft,'scene',p.prompt),false);next.refs={...next.refs,scene:''};next.pendingChanges={...(next.pendingChanges||{})};delete next.pendingChanges.environment;next.scenePreset=p.id;return next;}
const api={presets,referencePrompt,textOnly};if(typeof module!=='undefined')module.exports=api;else root.ScenePresets=api;
})(typeof window==='undefined'?globalThis:window);
