// Reviewed against each Design06 background description, not inferred from a
// category name or from words such as “可坐”. null means no usable seat is stated.
// These are prompt capabilities; whether a generated image depicts them still
// needs visual review. Keep the exact evidence phrase so catalog checks detect drift.
export const ENVIRONMENT_SEATS={
  studio:{'soft-gray':'低矮灰色拍摄方台','warm-paper':'木质摄影凳',charcoal:'低台'},
  window:{'light-wall':'木椅','wood-window':'藤编座椅',sheer:'亚麻扶手椅'},
  street:{'plain-corner':null,shopfront:'座椅','after-rain':null},
  arcade:{concrete:'低矮石凳',stone:'墙边石座',gallery:'木长椅'},
  home:{'linen-sofa':'亚麻沙发','dining-chair':'餐椅','clean-room':'单人椅'},
  green:{'tree-edge':'长椅',lawn:'长椅','bamboo-path':'低竹凳'},
  shore:{sand:null,'lake-deck':'固定长凳','rock-view':'矮座台'},
  dark:{'dark-wall':'黑色靠背椅','night-window':'单椅','dark-chair':'深棕皮革扶手椅'},
  'color-studio':{pink:'灰粉低方台',blue:'浅灰摄影凳',sage:'灰绿低台'},
  'texture-wall':{plaster:'低石凳',lime:'原木凳',clay:'矮陶土台'},
  'daylight-studio':{loft:'低台',wood:'木凳',curtain:'奶白木椅'},
  bedroom:{linen:'木椅',white:'扶手椅',wood:'窗边椅子'},
  balcony:{urban:'折叠休闲椅',garden:'藤编休闲椅',white:'户外椅'},
  cafe:{light:'木椅',industrial:'皮革长椅',retro:'焦糖皮革卡座'},
  bookshop:{oak:'木凳',library:'阅读椅',vintage:'藤椅'},
  restaurant:{bistro:'靠垫长椅',minimal:'棕色软包椅',dinner:'深木桌椅'},
  hotel:{suite:'单椅',lobby:'沙发组合',resort:'藤木休闲椅'},
  oldtown:{brick:null,stone:'可坐石沿',wood:null},
  rooftop:{plain:null,terrace:'户外椅',sunset:null},
  forest:{pine:'原木座位',birch:null,autumn:'木长椅'},
  meadow:{garden:'木长椅',field:null,'dry-grass':null},
  snowfield:{park:'木长椅',cabin:'木长凳','city-snow':null},
  lake:{path:'木长椅','stone-bank':'稳固长椅',willow:'固定长椅'},
  pier:{'wood-deck':'长凳',concrete:null,'coastal-road':null},
  poolside:{'white-pool':'白躺椅','garden-pool':'木躺椅','resort-pool':'躺椅'},
  office:{'window-office':'人体工学椅',meeting:'软包椅',lounge:'布艺沙发'},
  cowork:{desk:'可调椅',creative:'木椅',open:'办公椅'},
  'gallery-space':{'white-gallery':'木长凳','concrete-gallery':'木长椅','museum-lobby':'木座椅'},
  workshop:{pottery:'木凳',floral:null,craft:'工作凳'},
  track:{'red-track':null,'gray-track':null,stadium:null},
  court:{tennis:'长凳',basketball:'长椅','court-wall':'长凳'},
  fitness:{'clean-gym':'训练凳','dance-room':'置物长凳','yoga-room':null},
  trail:{'hill-path':'木座位','wood-trail':null,'country-road':null},
  nightstreet:{'warm-lights':null,'blue-city':null,'store-light':'门边椅子'},
  festival:{birthday:'沙发','winter-holiday':'扶手椅','new-year':null},
  rainlights:{reflect:null,'blue-reflect':null,covered:'长凳'},
  'vintage-apartment':{default:'扶手椅'},'record-shop':{default:null},
  'arcade-street':{default:'石阶'},'subway-entry':{default:null},
  newsstand:{default:null},'mountain-overlook':{default:null},'reed-path':{default:null},
  'minimal-stairs':{default:'台阶'},'glass-conservatory':{default:'长椅'},
  'concrete-courtyard':{default:'低石台'}
};

const SUBJECTS={
  arcade:'人物位于通道或已有座位，与柱墙错开，背景有纵深',
  green:'人物位于开阔位置或已有座位，枝叶位于远处，不遮脸和衣服',
  rooftop:'人物位于宽阔屋顶内侧，安全围护位于远处，天际线不穿头',
  festival:'人物前方留空，装饰退后；坐姿只使用所选背景已有的座位'
};

export function withEnvironmentCapabilities(space){
  const variants=space.variants.map(variant=>{
    const seat=ENVIRONMENT_SEATS[space.id]?.[variant.id]||null;
    const actions=[...(variant.actions||space.actions)].filter(action=>action!=='sit');
    if(seat)actions.splice(Math.min(1,actions.length),0,'sit');
    // The garden terrace describes a chair, not a wall or railing to lean on.
    if(space.id==='balcony'&&variant.id==='garden'&&actions.includes('lean'))actions.splice(actions.indexOf('lean'),1);
    const support={...space.support,...variant.support};
    const seatTarget=space.id==='restaurant'&&variant.id==='dinner'?'深木餐椅':seat;
    if(seat)support.sit=variant.support?.sit||(variant.id==='default'?space.support.sit:null)||`坐在背景中已有的${seatTarget}上，接触位置与腿脚支撑真实，不额外添加椅凳`;
    const requestedDefault=variant.defaultAction||space.defaultAction;
    return {...variant,seat,actions,support:Object.fromEntries(actions.map(action=>[action,support[action]])),defaultAction:actions.includes(requestedDefault)?requestedDefault:actions[0]};
  });
  // Directory search can find a space with at least one suitable background.
  // Applying it must always use the selected variant's actions and support.
  const actions=[...new Set(variants.flatMap(variant=>variant.actions))];
  const support=Object.fromEntries(actions.map(action=>[action,action==='sit'?'只使用所选背景中已存在的座位':space.support[action]]));
  return {...space,subject:SUBJECTS[space.id]||space.subject,variants,actions,support,defaultAction:variants.find(variant=>variant.id===space.defaultVariant).defaultAction};
}
