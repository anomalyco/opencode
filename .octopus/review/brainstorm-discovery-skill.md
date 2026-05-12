# Brainstorm（方案发散）机制同行评审报告

## 评审时间
2026-05-12

## 评审 Prompt
```
你是同行评审专家。直接输出评审结论，不要探索文件或运行代码。

【评审对象】为 octopus 项目 P0 Discovery 阶段新增的「方案发散」（brainstorm）机制。已内联到 skill:discovery（.opencode/skills/discovery/SKILL.md）和 analyst.md 中。

核心设计三大件：
(1) 默认方法：HMW 改写 + 保守/标准/激进三象限方案矩阵 + 类比迁移（翻 CHANGELOG/同类项目），至少列 3 个候选方案各标思路/trade-off/范围。
(2) 升级方法：7 方 LLM Panel Brainstorm，peer-review 的镜像应用——评审收敛投票、brainstorm 发散不投票、鼓励差异、analyst 去重聚类后综合筛选 3-5 个。Prompt 模板 <500 字自包含，bash 脚本复用 peer-review 模型清单。
(3) 触发条件：新功能/架构选型必做，bugfix/依赖升级/已有 discovery 延续跳过。Discovery 文档新增「方案空间」章节。

【评审维度】
维度1: 方案发散工作流设计——HMW→矩阵→类比→LLM Panel 升级路径是否逻辑递进？触发条件表格覆盖是否完整且不误触？三象限分类是否可用？
维度2: 内容完整度——5 步综合规则（收集/去重/聚类/筛选/归档）是否可执行？LLM prompt 是否足够激发多样性？Discovery 文档章节模板是否充分？
维度3: 项目集成——与 discovery skill/analyst agent 衔接是否自然？与 peer-review 镜像关系是否自洽？格式风格是否符合现有 skill 体系？

【输出格式】
维度1=[Go/NoGo]一句话
维度2=[Go/NoGo]一句话
维度3=[Go/NoGo]一句话
总评=[Go/NoGo]一句话
```

## 各方评审输出

### Claude Opus 4.7
维度1=[Go] HMW→三象限矩阵→类比迁移→LLM Panel 形成"轻量默认+按需升级"的递进路径，触发表区分新功能/架构选型与 bugfix/依赖升级合理，三象限（保守/标准/激进）作为粗粒度风险光谱可用且不过度约束。

维度2=[Go] 收集/去重/聚类/筛选/归档五步覆盖发散后必要的收敛动作，prompt 强调"鼓励差异、不投票"与 peer-review 形成对称且能激发多样性，方案空间章节模板（思路/trade-off/范围）足以让下游 architect 接手。

维度3=[Go] 作为 skill:discovery 子能力并由 analyst agent 触发与现有 P0 流程自然衔接，与 peer-review 共享模型清单和 bash 脚本实现"发散/收敛"镜像自洽，格式与现有 skill 体系一致。

总评=[Go] 三大件设计闭环、可执行、与现有 workflow 与 peer-review 体系互补，建议直接落地；唯一可选增强是在归档时记录"被淘汰方案+淘汰原因"以便后续 RCA 追溯。

### GPT 5.5
维度1=[Go] HMW→矩阵→类比→LLM Panel 的升级路径逻辑清晰，触发条件边界基本合理，三象限分类可操作。

维度2=[Go] 5 步综合规则具备执行闭环，prompt 约束适度且能鼓励多样性，Discovery「方案空间」章节足够支撑落档。

维度3=[Go] 与 discovery skill/analyst agent 衔接自然，peer-review 镜像关系自洽，整体格式符合现有 skill 体系。

总评=[Go] 该 brainstorm 机制可进入 P0 Discovery 流程，建议后续用真实 Discovery 案例校准触发边界和候选方案质量。

### Gemini 3.1 Pro
维度1=[Go] 工作流从常规矩阵发散到多模型并行激荡递进合理，触发边界明确有效，三象限法极大地提升了决策权衡的颗粒度。

维度2=[Go] 5步综合规则可执行性强，去重聚类有效解决了多模型生成的信息冗余，Discovery模板新增章节保障了方案选型的可追溯性。

维度3=[Go] 与 analyst 的职责契合完美，精妙地反向复用了 peer-review 的多模型基建（从收敛投票转为发散生成），保持了高度自洽的架构美感。

总评=[Go] 该机制以极低的改造成本（复用基建）实现了 P0 阶段的高质量方案发散，逻辑严密且高度可用，建议合并。

### DeepSeek V4 Pro
维度1=[Go] HMW→矩阵→类比→LLM Panel 递进逻辑清晰，三象限分类实用，但触发条件表可能漏覆盖重构/性能优化等也需发散的场景。

维度2=[Go] 五步综合规则可执行，HMW+类比已确保足够多样性，<500字模板虽紧但够用；Discovery文档章节模板与现有结构自然衔接。

维度3=[Go] 镜像 peer-review 的设计简洁自洽（评审收敛投票/brainstorm发散不投票），inline 到 discovery skill 和 analyst.md 的集成方式与现有 skill 体系一致。

总评=[Go] 机制设计完整，递进逻辑合理，与现有 skill/agent 体系衔接自然，建议补充触发条件对非功能需求类变更的覆盖。

### QWen 3.6 Plus
维度1=Go：HMW→三象限矩阵→类比迁移→LLM Panel 升级路径逻辑递进清晰，触发条件覆盖新功能/架构选型（必做）与 bugfix/依赖升级/延续（跳过）边界明确，保守/标准/激进三象限分类实用。

维度2=Go：5 步综合规则（收集/去重/聚类/筛选/归档）可执行，<500 字自包含 prompt 约束合理且利于多样性激发，Discovery 文档「方案空间」章节模板结构充分。

维度3=Go：与 discovery skill/analyst agent 衔接自然（analyst 负责去重聚类后综合筛选），与 peer-review 形成镜像自洽（评审收敛投票 vs brainstorm 发散不投票），格式风格符合现有 skill 体系。

总评=Go：三大件设计完整、边界清晰、与现有机制互补，可直接合入。

### Kimi K2.6
维度1=[Go]HMW→矩阵→类比→LLM Panel 构成清晰的"个体发散→结构化分类→外部借鉴→规模化发散"递进路径，触发条件区分新功能/架构与 bugfix/依赖升级合理，保守/标准/激进三象限分类直观可用。

维度2=[Go]收集/去重/聚类/筛选/归档五步规则符合发散-收敛经典流程且可执行；Prompt 控制在 500 字以内有利于保持 Skill 模板的简洁自包含性；Discovery 文档新增「方案空间」章节与现有需求分析框架衔接充分。

维度3=[Go]与 discovery skill 和 analyst agent 的衔接自然，复用 peer-review 的 7 方模型清单和 bash 脚本并反转其逻辑（收敛投票→发散不投票）设计精巧且自洽，格式风格与现有 Skill 体系保持一致。

总评=[Go]该 brainstorm 机制设计逻辑递进、内容完整、与现有体系集成自然，可直接落地。

### MiniMax M2.7
维度1=[Go] 升级路径递进清晰，三象限分类可用；触发条件中"明确的依赖升级"边界略显模糊，需 analyst 主观判断。

维度2=[Go] 5步综合规则可执行，prompt 模板自包含且明确要求"反直觉"，Discovery 文档章节模板充分。

维度3=[Go] 与 analyst agent 衔接自然，peer-review 镜像关系自洽（收敛 vs 发散）；模型清单引用"详见该 skill"但未给出跳转路径，略显隐晦。

总评=[Go] 机制设计完整、逻辑自洽，与现有 skill 体系融合良好，可进入实施阶段。

## 共识统计

| 投票 | 计数 | 名单 |
|------|------|------|
| Go   | 7    | Claude Opus 4.7, GPT 5.5, Gemini 3.1 Pro, DeepSeek V4 Pro, QWen 3.6 Plus, Kimi K2.6, MiniMax M2.7 |
| NoGo | 0    | — |

共识结果：**7/7 Go → 强制采纳**

## 改进建议
所有建议均为非阻塞的增强方向：

1. **触发条件扩展**（DeepSeek V4 Pro）：补充对重构/性能优化等非功能需求变更的覆盖
2. **淘汰记录**（Claude Opus 4.7）：归档时记录"被淘汰方案+淘汰原因"以便后续 RCA 追溯
3. **触发边界细化**（MiniMax M2.7）："明确的依赖升级"边界略显模糊，可增加判定示例
4. **模型清单可发现性**（MiniMax M2.7）：LLM Panel 模型清单引用可增加跳转路径
5. **真实用例校准**（GPT 5.5）：后续用真实 Discovery 案例校准触发边界和候选方案质量
