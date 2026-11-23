// Explicit choices, applied only after confirmation.
export const TONES=[
  {
    "id": "neutral",
    "name": "自然中性",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "自然中性影调，中等反差，亮暗层次完整；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "自然中性影调，中等反差，亮暗层次完整"
  },
  {
    "id": "highkey",
    "name": "明亮高调",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "明亮高调，柔和反差，白色和高光保留纹理，不过曝；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "明亮高调，柔和反差，白色和高光保留纹理，不过曝"
  },
  {
    "id": "lowkey",
    "name": "沉静低调",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "沉静低调，压低整体亮度，人物和衣料暗部仍清晰，不死黑；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "沉静低调，压低整体亮度，人物和衣料暗部仍清晰，不死黑"
  },
  {
    "id": "soft",
    "name": "柔和灰调",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "柔和灰调，降低反差、轻抬黑位，保留立体层次，不灰蒙；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "柔和灰调，降低反差、轻抬黑位，保留立体层次，不灰蒙"
  },
  {
    "id": "crisp",
    "name": "清透鲜明",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "清透鲜明的中高反差，黑白点清楚，肤质与织物细节不生硬；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "清透鲜明的中高反差，黑白点清楚，肤质与织物细节不生硬"
  },
  {
    "id": "warm",
    "name": "暖调柔光",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "克制暖调，亮部温暖、暗部柔和，避免全脸泛黄；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "克制暖调，亮部温暖、暗部柔和，避免全脸泛黄"
  },
  {
    "id": "cool",
    "name": "冷调清爽",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "克制冷调，背景与暗部略冷，避免皮肤和白衣整体染蓝；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "克制冷调，背景与暗部略冷，避免皮肤和白衣整体染蓝"
  },
  {
    "id": "film",
    "name": "清淡胶片",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "清淡胶片影调，柔和高光过渡，轻微褪黑与细颗粒，面料仍清晰；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "清淡胶片影调，柔和高光过渡，轻微褪黑与细颗粒，面料仍清晰"
  },
  {
    "id": "vintage",
    "name": "复古暖棕",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "低饱和复古暖棕氛围，中等反差，棕调主要在环境，人物衣服不过度偏色；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "低饱和复古暖棕氛围，中等反差，棕调主要在环境，人物衣服不过度偏色"
  },
  {
    "id": "muted",
    "name": "低饱和静谧",
    "category": "color",
    "categoryLabel": "彩色",
    "prompt": "静谧低饱和，中低反差，色彩克制但不发灰，保留相近颜色差异；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。",
    "summary": "静谧低饱和，中低反差，色彩克制但不发灰，保留相近颜色差异"
  },
  {
    "id": "bw-soft",
    "name": "柔和黑白",
    "category": "mono",
    "categoryLabel": "黑白",
    "prompt": "将最终照片以柔和黑白呈现，细腻灰阶，亮暗层次完整，服装款式与材质保持；黑白是最终色彩呈现方式，优先于颜色保留要求；仅转换成片色彩，不更换场景光源方向、人物动作或衣物。",
    "summary": "将最终照片以柔和黑白呈现，细腻灰阶，亮暗层次完整，服装款式与材质保持"
  },
  {
    "id": "bw-bold",
    "name": "高反差黑白",
    "category": "mono",
    "categoryLabel": "黑白",
    "prompt": "将最终照片以高反差黑白呈现，黑白分明，面部与衣料细节不压死，服装款式与材质保持；黑白是最终色彩呈现方式，优先于颜色保留要求；仅转换成片色彩，不更换场景光源方向、人物动作或衣物。",
    "summary": "将最终照片以高反差黑白呈现，黑白分明，面部与衣料细节不压死，服装款式与材质保持"
  }
];
export const CAMERA_ANGLES=[
  {
    "id": "eye",
    "name": "平视",
    "category": "camera",
    "categoryLabel": "机位角度",
    "prompt": "相机与人物视线接近等高，平视拍摄；只改变观察机位，不改变参考动作。",
    "summary": "相机与人物视线接近等高，平视拍摄"
  },
  {
    "id": "low",
    "name": "仰拍",
    "category": "camera",
    "categoryLabel": "机位角度",
    "prompt": "相机低于人物视线，适度向上仰拍，避免夸张拉伸；只改变观察机位，不改变参考动作。",
    "summary": "相机低于人物视线，适度向上仰拍，避免夸张拉伸"
  },
  {
    "id": "high",
    "name": "俯拍",
    "category": "camera",
    "categoryLabel": "机位角度",
    "prompt": "相机高于人物视线，适度向下俯拍，保留真实头身比例；只改变观察机位，不改变参考动作。",
    "summary": "相机高于人物视线，适度向下俯拍，保留真实头身比例"
  },
  {
    "id": "overhead",
    "name": "高位俯拍",
    "category": "camera",
    "categoryLabel": "机位角度",
    "prompt": "相机在人物上方高位向下拍摄，接近鸟瞰，保留主要姿态与承重关系；只改变观察机位，不改变参考动作。",
    "summary": "相机在人物上方高位向下拍摄，接近鸟瞰，保留主要姿态与承重关系"
  },
  {
    "id": "ground",
    "name": "贴地仰拍",
    "category": "camera",
    "categoryLabel": "机位角度",
    "prompt": "相机贴近地面向上拍摄，低机位仰视，避免脚部和四肢夸张畸变；只改变观察机位，不改变参考动作。",
    "summary": "相机贴近地面向上拍摄，低机位仰视，避免脚部和四肢夸张畸变"
  }
];
