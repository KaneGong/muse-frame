# Muse Frame shot planner · Agent 拍摄计划

Muse Frame 0.6 接受由 Agent 草拟的 1 至 12 镜头人像计划。可以先在对话里调整张数、构图和拍摄要求，满意后把计划文件拖入系统文件选择器，或将 JSON 粘贴至首页「导入 Agent 拍摄计划」。预览后点「建立独立拍摄」，在本机选人物、服装和参考，再核对生成数量及平台费用。

## ChatGPT 与 Codex

本仓提供 skills-only 插件。支持仓库插件源的 Codex 可以使用下列命令，然后在新对话里调用 Muse Frame。ChatGPT 桌面端如提供仓库插件源，选择本仓源并安装 Muse Frame。网页或移动端的公共插件发现依赖 OpenAI 目录审核；GitHub 下载本身不会使插件进入公共目录。

```sh
codex plugin marketplace add KaneGong/muse-frame --ref v0.6.1
codex plugin add muse-frame@muse-frame-studio
```

## DeepSeek Harness

桌面 0.6.1 随附的 DSH 插件版本为 0.6.0。从[发行页下载插件压缩包](https://github.com/KaneGong/muse-frame/releases/download/v0.6.1/muse-frame-shot-planner-0.6.0.tgz)，在文件所在目录运行下列命令。以 web 为例，使用其他 profile 时替换其名称。重新打开该 profile，在具备技能加载能力的 Agent 中请求 Muse Frame 镜头计划。

```sh
dsh plugin --profile web add ./muse-frame-shot-planner-0.6.0.tgz
```

若想在客户端内搜索，可在「插件」启用「自定义插件索引」，打开「发现」→「添加索引源」，添加 [Muse Frame 索引](https://raw.githubusercontent.com/KaneGong/muse-frame/main/plugins/dsh-index.json)，再搜索 Muse Frame 并核对安装来源。该索引由项目维护。社区注册表的收录进度见[审核工单 #137](https://github.com/majiayu000/dsh-plugin-registry/issues/137)。

## 示例

对 Agent 说「用 Muse Frame 做一组三张的雨后街拍。保持人物和服装一致，第一张全身，第二张半身，第三张拍肩包细节」。在桌面预览页可查看每个镜头的文字，再确认创建。支持同一技能格式的其他 Agent 可使用 [shot-planner](../plugins/muse-frame/skills/shot-planner/SKILL.md)。当前插件通过计划文件与桌面交换创作文字。

## English

Use the Muse Frame plugin to draft a portrait series. Download the JSON or copy the JSON block. In Muse Frame 0.6+, choose **Import agent shot plan → Review plan → Create separate shoot**. Add your reference images locally and review provider costs before submitting. The Codex repo marketplace and DSH profile commands above install the skills-only planner. ChatGPT public directory distribution requires OpenAI review. Desktop 0.6.1 ships the DSH planner 0.6.0. In DSH, enable Custom plugin indexes, open Discover, add the [project index](https://raw.githubusercontent.com/KaneGong/muse-frame/main/plugins/dsh-index.json), then search for Muse Frame. [Community registry submission](https://github.com/majiayu000/dsh-plugin-registry/issues/137).
