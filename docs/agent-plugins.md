# Muse Frame shot planner · Agent 拍摄计划

Muse Frame 0.6 接受由 Agent 草拟的 1 至 12 镜头人像计划。可以先在对话里调整张数、构图和拍摄要求，满意后把计划文件拖入系统文件选择器，或将 JSON 粘贴至首页「导入 Agent 拍摄计划」。预览后点「建立独立拍摄」，在本机选人物、服装和参考，再核对生成数量及平台费用。

## ChatGPT 与 Codex

本仓提供 skills-only 插件。支持仓库插件源的 Codex 可以使用下列命令，然后在新对话里调用 Muse Frame。ChatGPT 桌面端如提供仓库插件源，选择本仓源并安装 Muse Frame。网页或移动端的公共插件发现依赖 OpenAI 目录审核；GitHub 下载本身不会使插件进入公共目录。

```sh
codex plugin marketplace add KaneGong/muse-frame --ref v0.6.1
codex plugin add muse-frame@muse-frame-studio
```

## DeepSeek Harness

DSH 社区目录已将 Muse Frame 收入精选，审核固定在 `7a19047`。[维护者确认](https://github.com/majiayu000/dsh-plugin-registry/issues/138#issuecomment-7090968404) · [社区插件市场](https://plugin.dshdesk.com/)

在 DeepSeek Harness 桌面端，打开「插件」，从「添加插件」下拉菜单选择「安装第三方插件」。把下面的地址粘贴到「包名或地址」，点击「安装」，完成后选「立即启用」。

```text
https://github.com/KaneGong/muse-frame/archive/7a19047e8c968ada024ff8c8ddc1bbf85ad1ea88.tar.gz
```

使用 DSH Web 的用户可在命令行安装同一份归档，然后重新打开该 profile：

```sh
dsh plugin --profile web add https://github.com/KaneGong/muse-frame/archive/7a19047e8c968ada024ff8c8ddc1bbf85ad1ea88.tar.gz
```

在新对话里请 DSH 用 Muse Frame 做拍摄计划。桌面发行页另附独立插件 `muse-frame-shot-planner-0.6.0.tgz`，与社区根包 `muse-frame` 0.6.1 提供同一技能，任选一种安装即可。也可在「插件 → 发现」添加 [Muse Frame 项目索引](https://raw.githubusercontent.com/KaneGong/muse-frame/main/plugins/dsh-index.json)，搜索 Muse Frame。[独立插件下载](https://github.com/KaneGong/muse-frame/releases/download/v0.6.1/muse-frame-shot-planner-0.6.0.tgz)

## 示例

对 Agent 说「用 Muse Frame 做一组三张的雨后街拍。保持人物和服装一致，第一张全身，第二张半身，第三张拍肩包细节」。在桌面预览页可查看每个镜头的文字，再确认创建。支持同一技能格式的其他 Agent 可使用 [shot-planner](../plugins/muse-frame/skills/shot-planner/SKILL.md)。当前插件通过计划文件与桌面交换创作文字。

## English

Use the Muse Frame plugin to draft a portrait series. Download the JSON or copy the JSON block. In Muse Frame 0.6+, choose **Import agent shot plan → Review plan → Create separate shoot**. Add your reference images locally and review provider costs before submitting. The [DSH community registry](https://plugin.dshdesk.com/) accepted the planner as a curated entry at commit `7a19047`. In DSH Desktop, choose **Plugins → Add plugin → Install third-party plugin**, paste the archive URL above, install it, then choose **Enable now**. In DSH Web, use the command above. The standalone release archive and the curated root package load the same skill. [Reviewer confirmation](https://github.com/majiayu000/dsh-plugin-registry/issues/138#issuecomment-7090968404).

Codex users can install the repo marketplace with the commands above. ChatGPT public directory submission is on hold.
