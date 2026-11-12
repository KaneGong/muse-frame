// Distinct original intentions, restored into the searchable detail groups.
export const RESTORED_DETAIL_OPTIONS={
  hair:[{id:'wind-strands',name:'风吹发丝',category:'loose',categoryLabel:'披发整理',
    summary:'少量自然发丝随风轻动，原发型仍可辨',
    prompt:'少量自然发丝随轻风产生真实方向与轻微动态，保留原发型轮廓，不让头发遮住双眼或主要服装结构；保持参考发长、发量、发色、发际线与人物身份，不把短发拉长',tags:['风吹发丝','轻风','发丝动态']}],
  weather:[{id:'drizzle',name:'细雨',category:'wet',categoryLabel:'雨后与水汽',
    summary:'环境中正在下细雨，雨丝克制且符合光线',
    prompt:'环境中正在下轻微细雨，少量雨丝和小水滴符合现场光线；保留场所通道与遮蔽处，不替换用户服装，不自动改变衣料透明度、妆容或发型，是否淋雨由人物位置和补充要求决定',tags:['细雨','正在下雨','小雨']}],
  prop:[{id:'handbag',name:'手袋道具',category:'daily',categoryLabel:'日常生活',
    summary:'为这张添加简洁无品牌手袋，保留已有穿搭',
    prompt:'仅本张可添加一只简洁无品牌手袋作为手持道具，手柄、包身与手指接触关系可信；不替换已有参考包，不把新增道具当作用户真实商品，不遮挡主要服装结构，已有包时不重复增加',tags:['手袋','手包','手持包']}]
};
