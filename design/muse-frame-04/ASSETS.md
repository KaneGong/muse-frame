# 素材来源

- `assets/muse-frame-mark.png`：已有 Muse Frame 项目标志，直接复用，未重新设计。
- `assets/style-A.jpg` 至 `style-G.jpg`：原工作台 `app/static/assets.json` 中的 7 张风格插图。它们是原版 AI 静物示意，不是当前模型效果证明。
- `assets/street.webp`、`daylight.webp`、`editorial.webp`、`winter.webp`：维护者已明确提供给本项目文档与产品展示的 AI 作品。保留其独立素材用途，不因代码开源而授予任意图片使用权。
- `assets/icons/`：沿用原型图标，MIT 通知在该目录 LICENSE 中。
- `data/library.json`、`scenes.json`：原工作台摄影选项与场景元数据。`data/costumes.json` 为既有图库目录元数据。
- `assets/diagrams/`：Design03 绘制、Design04 复用的八类拍摄空间矢量示意。取景示意由界面内 SVG 绘制。它们表达空间和构图关系，不是实际生成结果或已验证摄影案例。
- `creative-base.mjs` 保留 Design03 基线；`catalog-expansion.mjs`、`detail-presets.mjs` 与 `creative-data.mjs` 为本轮扩充、归类的拍摄安排、空间、光影、取景与人物状态；旧选项仅作为底层控制及专业细调资料。

三个在线图库按需加载，不把其原图或在线缩略图打包到交付文件。页面保留来源入口及作者信息。人物来源：[AI Portrait Gallery](https://ai-portrait-gallery.pages.dev/)；服装来源：[AI Costume Gallery](https://ai-costume-gallery.pages.dev/)；姿态来源：[AI Pose Gallery](https://ai-pose-gallery.pages.dev/) 与 [中文目录](https://github.com/anhao/ai-pose-gallery-zh)。

原项目的完整素材声明位于仓库根目录 `ASSET_LICENSES.md`。本原型不含用户数据库、私人照片或平台账户资料。

Design06 的 `assets/generated/`：154 张本轮 AI 示例与对应缩略图，包含 36 套拍法首图、118 个准确对应背景变化的单画幅环境图。人物均以图库人物 `f15a069b8a3` 为唯一身份参考；服装参考分别使用 `SPR-0219`、`SUM-0176`、`SPR-0202`、`WIN-0104`、`PTY-0031`。运动休闲拍法服装为原创中性运动套装，未冒称图库参考。图库参考原图只保留在制作工作目录，不随原型分发。

工具为内置 image_gen，精确模型版本未披露，不声明为 GPT Image 2.6。PNG 原图、实际采用提示词和逐张来源随交付保存。仅对展示版本等比缩小与 WebP 编码，未以代码裁切或修饰原图。未采用初稿保留在工作目录，不接入界面。

36 张首图也作为各拍法封面，属于复用而非新增 36 张图；它们不等于 36 套完整组图。其他镜头、光影/妆发等对比素材、真实商品资料仍按清单标为待补。示例不证明商用素材权利或真实商品还原通过，代码许可不扩展为图库原图许可。

取景照片补齐（2026-11-10）：`framing-*.webp` 对应12种取景。完整穿搭复用已审核的 `plan-urban-editorial` 原图，其他11张以该图为场景与服装基准，使用同一人物和服装参考生成。只有相机取景、人物位置及留白变化；图片用等比缩放编码，未裁切或放大充当高清。新增照片只解释取景，不能代表用户当前素材或真实任务结果。实际提示词和来源见本轮交付台账。
