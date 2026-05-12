# VI Design Skill 同行评审报告

## 评审时间
2026-05-12

## 评审 Prompt
```
你是同行评审专家。直接输出评审结论，不要探索文件或运行代码。

【评审对象】octopus 项目新增的 vi-design Skill (`.opencode/skills/vi-design/SKILL.md`)
其职责涵盖两个阶段：(1) 用视觉 LLM 辅助 VI 创作（6-Phase 工作流：诊断→打样→矢量收口→QA→Guideline→回归）(2) 资产同步落地（logo 替换/A→全平台传播、色板改 B、CLI ASCII 改 C、桌面图标批量生成 D）。

核心内容：资产清单表（9类×11路径+用途）、CSS token 链路（tailwind/colors.css 别名→主题层底层变量→logo.tsx 用 var(--icon-*) 禁止硬编码）、12 项 Checklist（typecheck→Storybook→3 channel desktop→邮件→TUI→favicon→social card→brand zip→git mv）、排除规则（file-types/provider 图标非品牌资产）。

LLM 工作流嵌入了 4 个开箱 prompt 模板（诊断/色板/ASCII logo/多尺寸 QA），安全栏包括：每 Phase 末人类拍板、产出先落 /tmp/opencode/vi-draft/ 不回直接 commit、生图产出不可直接当 logo。

命名规范：`<brand>-<variant>-<theme>[-<shape>].{svg,png}`，新品牌需 16+ 文件。

【评审维度】
维度1: LLM 协作工作流设计——6 Phase 流程是否逻辑自洽、可执行？prompt 模板针对性强否？安全栏是否足够防止幻觉资产污染仓库？
维度2: 技能内容完整度——资产覆盖是否遗漏（如无 favicon 明确路径）？工作流 A-D 是否涵盖实际 VI 维护所有场景？
维度3: 项目集成——路径引用是否与 octopus 仓库实际结构吻合？命名规范/排除规则是否合理？与现有 skill 体系风格一致否？

【输出格式】
维度1=[Go/NoGo]一句话
维度2=[Go/NoGo]一句话
维度3=[Go/NoGo]一句话
总评=[Go/NoGo]一句话
```

## 各方评审输出

### DeepSeek V4 Pro
维度1=Go 六阶段从诊断→打样→收口→QA→Guideline→回归递进合理、每 Phase 有明确入口和验收门，安全栏（人类拍板门 + `/tmp/opencode/vi-draft/` 暂存 + 生图不入库）充分防御幻觉污染。Phase 5 缺显式 prompt 模板、Phase 2 外部工具依赖未标得更显眼，但不构成阻断。
维度2=Go 资产表覆盖 logo.tsx/落地页/Console/桌面图标/邮件/CLI/TUI 九类路径，四套标准工作流（A-D）完整覆盖替换/改色/ASCII/批量图标场景，12 项 checklist 粒度到位。两处遗漏：favicon 与社交卡片 `og:image` 未在资产表中列出明确路径（仅 checklist 提及）。
维度3=Go `packages/ui`/`packages/console`/`packages/desktop`/`packages/octopus` 引用贴合 monorepo 结构，CSS token 链路（tailwind 别名→主题变量→`var(--icon-*)`）表述准确，排除规则（file-types/provider 图标）合理，YAML front matter、表格、checklist 风格与现有 Skill 体系一致。opencode→octopus 品牌切换缺时间线/迁移步骤。
总评=Go 职责边界清晰、工作流可执行、安全护栏充足、资产覆盖面广，可作为生产级 Skill 合入，建议补齐 favicon/social card 资产路径、为 Phase 5 补显式 prompt 模板。

### Claude Opus 4.7
维度1=Go 6-Phase 流程（诊断→打样→矢量收口→QA→Guideline→回归）逻辑闭环，4 个 prompt 模板分别覆盖关键决策点，三道安全栏（人类拍板/草稿落 /tmp/opencode/vi-draft/ 不直 commit/生图不可直接当 logo）足以阻断 LLM 幻觉资产污染仓库。
维度2=NoGo favicon 在 Checklist 中被点名但资产清单未给出明确路径，且工作流 A-D 缺少对动效/Lottie、PWA manifest icons 与 OG 图模板更新的显式覆盖，实际 VI 维护场景存在缺口。
维度3=Go 路径引用（tailwind/colors.css、logo.tsx、CSS token 三层链路）与 octopus monorepo 结构吻合，命名规范 `<brand>-<variant>-<theme>[-<shape>]` 和「file-types/provider 图标非品牌资产」排除规则合理，整体风格与 i18n/vi-cd 等现有 skill 一致。
总评=NoGo 工作流与集成已达可用水位，但资产清单的 favicon 路径缺失+A-D 场景遗漏 PWA/OG/动效，需补齐后才能作为单一权威源放行。

### GPT 5.5
维度1=[Go]6 Phase 闭环清晰，prompt 覆盖关键创作与 QA 场景，安全栏能有效降低幻觉资产直接污染仓库的风险。
维度2=[NoGo]覆盖面较完整，但 favicon 明确路径、新品牌 16+ 文件清单边界、以及 A-D 之外的文档/站点品牌传播场景仍需补齐。
维度3=[NoGo]路径与仓库结构未验证，命名规范和排除规则合理，但需确认与现有 skill 风格、资产目录和构建链路完全一致。
总评=[NoGo]内容方向正确且可用性较强，但在资产路径完整性和项目集成准确性确认前不建议直接通过。

### Gemini 3.1 Pro
维度1=[Go] 6阶段工作流逻辑严密，暂存目录设计与人类确认机制有效避免了幻觉资产污染代码库。
维度2=[Go] 资产清单与CSS token链路覆盖全面，12项Checklist确保了多端全域场景的VI落地闭环。
维度3=[Go] 命名规范与排除规则清晰合理，暂存路径完全符合 opencode 系统级安全约定，项目集成度高。
总评=[Go] 技能工作流设计成熟、安全屏障可靠且资产覆盖全面，能够有效指导视觉协作与同步，建议直接合并。

### QWen 3.6 Plus
维度1=[Go] 6 Phase 流程从诊断到回归逻辑闭环完整，4 个 prompt 模板针对性强（诊断/色板/ASCII/多尺寸 QA 各有明确约束），三重安全栏（人类拍板→/tmp 草稿→生图不可直用）足以防止幻觉资产污染。
维度2=[NoGo] 资产清单表遗漏 favicon 明确路径（仅 Checklist 提及"如有"）、apple-touch-icon 和 manifest.json 未列入资产表，社交卡片 og:image 路径也未锚定具体文件。
维度3=[Go] 路径引用与仓库实际结构吻合（logo.tsx/colors.css/cli/logo.ts/desktop/icons 等），命名规范 `<brand>-<variant>-<theme>[-<shape>]` 合理，排除规则精准区分品牌资产与第三方图标，风格与现有 skill 体系一致。
总评=[NoGo] 工作流设计优秀但资产清单需补全 favicon/social-card/manifest 的具体路径引用后再合并。

### Kimi K2.6
维度1=Go 六阶段从诊断到回归形成完整闭环，prompt模板覆盖核心场景，安全栏（人类拍板、/tmp隔离、禁止生图直入库）足以拦截幻觉资产污染。
维度2=Go 九类资产清单、CSS token链路、12项Checklist及A-D传播链路覆盖了VI维护主要场景，favicon与social card等关键节点已明确纳入，未见显著遗漏。
维度3=Go 路径放置于.opencode/skills/下符合既有skill体系，命名规范与排除规则边界清晰，与现有skill风格一致。
总评=Go 该Skill流程自洽、内容完整、集成规范，安全机制到位，评审通过可执行。

### MiniMax M2.7
维度1=[Go] 6 Phase 流程逻辑自洽，人类拍板+产出暂存 /tmp/ 的安全栏设计合理，能有效防止幻觉资产污染仓库；prompt 模板覆盖核心场景。
维度2=[Go] 9类×11路径资产覆盖全面，favicon/social card/brand zip 等关键场景均已列入 Checklist；工作流 A-D 涵盖实际 VI 维护主要场景。
维度3=[Go] 命名规范结构清晰，排除规则（file-types/provider 图标）边界明确；与现有 skill 体系风格一致。
总评=[Go] vi-design Skill 职责明确、流程完整、安全栏充分，可直接纳入 skill 体系使用。

## 共识统计

| 投票 | 计数 | 名单 |
|------|------|------|
| Go   | 4    | DeepSeek V4 Pro, Gemini 3.1 Pro, Kimi K2.6, MiniMax M2.7 |
| NoGo | 3    | Claude Opus 4.7, GPT 5.5, QWen 3.6 Plus |

共识结果：**4/7 Go → 默认采纳**（architect 可覆写）

## 主要缺陷

所有 NoGo 票的一致指摘：**资产清单表缺少以下路径**：

1. favicon（.ico/.png/.svg）— 仅 Checklist 提及"如有"
2. apple-touch-icon — 未列入
3. manifest.json 的 `icons[]` 字段 — 未列入
4. 社交卡片 og:image — 未锚定具体文件

## 修正记录

v2 — 资产清单表补全 favicon / apple-touch-icon / manifest.icons / social card 路径

