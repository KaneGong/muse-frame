// Original place descriptions restored from the V3 24-scene document.
// Existing Design04 IDs and its 108 variants are intentionally unchanged.
const space=(id,name,category,diagram,summary,scene,actions,subject,composition,support,caution,more={})=>({
  id,name,category,diagram,summary,goals:['portrait','outfit','social','campaign'],actions,
  subject,composition,support,caution,featured:false,tags:['原版场所',summary],
  defaultAction:actions[0],defaultMood:'soft',defaultVariant:'default',
  variants:[{id:'default',name,scene,palette:'保留场所原有材质与色彩'}],
  sourceNote:'恢复原有场所的布局、生活细节和可用支撑。示例只说明环境，不改变人物和服装。',
  ...more
});

export const RESTORED_SPACES=[
  space('vintage-apartment','复古公寓','home','living','旧木地板、拱门与扶手椅，房间有前后层次',
    '旧木地板、拱门和有使用痕迹的扶手椅，走廊通向明亮房间；窗口、椅面和前景门框互相分开',
    ['stand','sit','walk'],'人物在房间开口与扶手椅之间留出距离，保留公寓原有生活气息','用门框作前景，窗边人物与明亮后室分层',
    {stand:'门框内侧保留完整站位，脚下地板连续',sit:'坐在已有扶手椅上，椅面与腿脚接触合理',walk:'沿房间之间已有走廊行走，不穿越家具'},
    '保持旧公寓年代感，不改成空白摄影棚；椅子与房间开口不得互相穿插'),
  space('record-shop','唱片店','leisure','living','两侧唱片柜与通街玻璃，店内通道有纵深',
    '低矮唱片柜沿两侧布置，入口玻璃透向街面，中间保留可通行的纵深，店内层架与柜台位置稳定',
    ['stand','walk'],'人物位于唱片柜之间的主通道，保留柜台和街面入口','低柜引导视线向后，人物与陈列保持自然比例',
    {stand:'柜旁有完整站位，不坐在唱片陈列柜上',walk:'沿两排低柜中间的清楚通道行走'},
    '保留正常陈列和生活痕迹；不要求唱片封套出现可读品牌或文字'),
  space('arcade-street','老街骑楼','city','corridor','沿街柱廊、木门与石阶，既能走也能坐靠',
    '连续柱廊沿街道延伸，店面有木门与石阶，柱间可站可走；保持砖墙、立柱与街面透视连贯',
    ['stand','walk','sit','lean'],'人物在骑楼柱间，店面和街面仍可辨认','柱列形成纵深，木门和石阶提供不同高度的背景',
    {stand:'站在柱间完整地面，不占用车道',walk:'沿连续有遮蔽的骑楼步行区行走',sit:'使用店前实际存在的低石阶，脚落在下方地面',lean:'倚靠已有砖柱或木门旁墙面，接触自然'},
    '不要替换成现代空连廊；石阶、木门、街面与柱列须属于同一街道'),
  space('subway-entry','地铁入口','city','corridor','台阶、扶手、雨棚与入口旁的驻足平台',
    '露天入口的台阶、扶手与雨棚连接街面，入口侧平台留出驻足位置，台阶尺度和护栏连接合理',
    ['stand','walk','lean'],'人物位于入口侧平台，地铁口与街面关系清楚','用台阶和扶手引导纵深，完整保留脚下平台',
    {stand:'在入口侧平台站立，不堵住上下通道',walk:'沿入口侧的平整街面行走，不跨越踏步',lean:'轻靠平台已有稳固栏杆，栏杆高度合理'},
    '入口不凭空悬空；不要添加不可辨的巨型站名或把扶手截断'),
  space('newsstand','街边报刊亭','city','street','刊架、遮棚和旁边完整的人行区',
    '小型报刊亭靠近街角，一侧露出刊架与遮棚，旁边有完整人行区，深处是街树和店面',
    ['stand','walk'],'人物站在报刊亭旁，保留刊架与街树的生活信息','报刊亭作侧面背景，不遮住人物完整轮廓',
    {stand:'亭旁有完整人行地面，站位不穿入刊架',walk:'沿亭旁人行区行走，前方通道可见'},
    '报刊亭保留真实尺度和陈列；不生成醒目假标题或品牌字样'),
  space('mountain-overlook','山间观景台','nature','park','山路连接石质平台，近岩石与远山分层',
    '山路连接开阔石质平台，栏杆内侧有平整取景区，近处岩石与远处层叠山脊区分清楚',
    ['stand','walk','lean'],'人物在栏杆内侧平整平台，远山只做背景','平台地面、近处岩石与层叠山脊形成清楚前后关系',
    {stand:'在栏杆内侧平整取景区站立',walk:'沿山路连接平台的稳定区域行走',lean:'只轻靠内侧实际稳固栏杆，不坐跨栏杆'},
    '观景台要有真实平台与栏杆，不能退化为远处低山的一条普通小路'),
  space('reed-path','湿地芦苇径','water','park','芦苇与浅水间的木径，设加宽停步点',
    '窄木径穿过芦苇与浅水，设一个加宽停步点，芦苇前景不会封死通路，远处水域保持开阔',
    ['stand','walk'],'人物位于加宽停步点或木径中央，芦苇只遮画面边缘','以芦苇为近景，木径为中景，远水面保持开阔',
    {stand:'站在加宽停步点，完整脚部和木板地面可见',walk:'沿连续木径行走，不踩入浅水或芦苇'},
    '保留湿地浅水而非换成树林；芦苇不能封死路，也不凭空添加座椅'),
  space('minimal-stairs','极简楼梯间','city','corridor','折线楼梯、上层平台与连贯的扶手',
    '折线楼梯与上层平台形成层次，扶手连接连续，梯脚留出拍摄区，可利用平台和台阶形成不同高度',
    ['stand','sit','walk'],'人物在梯脚、转角平台或宽踏步，楼梯结构完整','楼梯折线提供方向，保留上下平台与完整落脚关系',
    {stand:'在梯脚或转角平台的平整区域站立',sit:'坐在已有宽踏步，双脚自然落在下方踏步或地面',walk:'只在清楚连续的踏步上缓慢行走，脚掌与踏步接触可信'},
    '扶手、平台、踏步必须能实际连接；避免楼梯穿墙和不可能的高度'),
  space('glass-conservatory','玻璃温室','leisure','park','透明顶棚、金属框架与植栽间的连续路径',
    '透明顶棚和金属框架包围植栽，中央路径连续，侧边有长椅与可用空地，玻璃反射与构架一致',
    ['stand','walk','sit'],'人物位于温室路径和侧边空地，植物不盖住脸和服装','保留透明屋顶与金属框架，植物分成前中后层',
    {stand:'侧边空地可完整站立，脚下路径连续',walk:'沿温室中央路径行走，不穿过花盆',sit:'坐在侧边实际存在的长椅上，椅面与腿脚关系合理'},
    '不要替换成露天花园；玻璃反射与同一金属构架一致'),
  space('concrete-courtyard','清水混凝土中庭','city','corridor','柱列围绕开放中庭，低石台和阶梯可坐靠',
    '清水混凝土柱列围住开放中庭，低石台和阶梯提供可用支撑，近柱、中庭和远墙形成清晰透视',
    ['stand','walk','sit','lean'],'人物位于中庭地面或低石台，开放空间和柱列都保留','近柱作前景，中庭留出空间，远墙承接光影',
    {stand:'中庭平整地面留出完整站位',walk:'沿柱列与中庭之间的连续地面行走',sit:'坐在已存在的低石台或宽阶梯上，脚有自然支撑',lean:'倚靠实际柱面或低石台，接触点清楚'},
    '必须保留开放中庭、低台和阶梯，不简化为一条空灰色连廊')
];

// Same broad place already exists: add findable original names without changing its settings or image binding.
export const ORIGINAL_SPACE_ALIASES={
  bookshop:['书店阅读区','现代书店咖啡区'],cafe:['咖啡馆窗边'],home:['现代客厅','落地窗起居室'],
  hotel:['酒店窗边'],rooftop:['城市屋顶','城市屋顶露台'],pier:['海边步道'],
  'daylight-studio':['自然光白棚','自然光白色影棚'],dark:['深灰质感棚','深灰质感影棚'],
  'gallery-space':['美术馆长廊','现代美术馆长廊'],
  street:['城市十字街口'],oldtown:['砖墙小巷'],green:['林荫公园'],
  meadow:['草坡与孤树'],shore:['湖边木栈桥']
};
