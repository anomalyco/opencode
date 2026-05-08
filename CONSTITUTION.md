# YunPat OpenCode 项目宪法

> 本宪法是 YunPat OpenCode 项目的最高设计文档。所有架构决策、功能设计、代码实现必须符合本宪法。当技术实现与宪法冲突时，以宪法为准。

---

## 第一章：身份与愿景

### 第一条：项目身份

YunPat OpenCode 是一个**面向知识产权领域的 AI 代理平台**，基于 OpenCode 开源 AI 编码代理平台扩展，支持终端、桌面应用、Web 和 VSCode 插件等多端交互。

它既是：
- **专业生产力工具** — 为专利代理人和企业 IP 部门提供日常工作支持
- **AI 代理运行时** — 可调度多个专业智能体协同完成复杂任务
- **通用编码助手** — 保留 OpenCode 的全部现有能力（编码、文件操作、Shell、Git 等）

### 第二条：目标用户

| 用户角色 | 核心诉求 |
|---------|---------|
| 专利代理师 | 高效完成专利撰写、审查意见答辩、复审无效等实务工作 |
| 企业 IP 管理人员 | 全流程管控、质量监控、布局决策 |
| 发明人/技术工程师 | 技术交底、专利理解、侵权预警 |
| IP 决策者 | 专利价值评估、布局策略、风险分析 |

### 第三条：愿景路径

```
Phase 0 (当前): 基于 OpenCode 平台扩展专利智能体 Plugin，建立 YunPat 专利智能体与 OpenCode 通用能力的融合架构
Phase 1: 固定场景智能体 — 专利撰写、OA 答辩、补正、复审、无效、规则研究
Phase 2: 全流程管理 — 从发明披露到授权维护的生命周期管理
Phase 3: 多 IP 类型 — 扩展商标、版权、商业秘密等领域智能体
Phase 4: 协作网络 — 多智能体协同处理跨领域复杂案件
```

---

## 第二章：核心原则

### 第四条：人机协作原则

**人主导，AI 辅助。所有 Phase 1 场景均为"人主导 + AI 辅助"模式。**

1. AI 不替代专业判断 — 涉及法律效力、策略选择、权利要求范围的决策必须经人确认
2. 人在环中 (Human-in-the-Loop) — AI 可主动建议，但执行前必须经用户审批确认
3. 渐进自主 — 随着信任建立和验证通过，逐步扩大 AI 自主操作范围（Phase 2+）
4. 可追溯性 — 每个 AI 生成的内容必须能追溯到具体的指令、上下文和决策点
5. 所有场景统一 — 不存在"AI 主导"的场景，AI 始终是辅助工具而非决策者

### 第五条：专业性原则

**对知识产权领域的准确性负责。**

1. 法律合规 — 所有专利相关功能必须遵循中国专利法及实施细则、审查指南等法规
2. 专业术语精确 — 使用规范的专利术语，不得随意简化或曲解
3. 流程合规 — 专利申请、答辩、复审等流程必须严格遵循国知局规定
4. 知识可验证 — 引用的法规、案例、条款必须可追溯源头

### 第六条：渐进演化原则

**从固定场景开始，逐步扩展到复杂场景。**

1. 先固化后灵活 — 先实现明确流程的自动化，再处理模糊场景
2. 先验证后推广 — 新智能体必须通过专业验证才能进入生产使用
3. 先辅助后自主 — 先提供辅助信息让用户决策，再逐步提供自动化建议
4. 数据驱动迭代 — 根据实际使用数据决定下一个优化方向

### 第七条：平台开放原则

**是一个可扩展的平台，不是一个封闭的产品。**

1. 智能体可插拔 — 每个专业智能体独立开发、独立部署、独立升级
2. 工具可扩展 — 通过 MCP、Skills、Hooks 机制接入外部能力和数据源
3. 模型可替换 — 不绑定特定 LLM，支持多种模型适配不同任务
4. 界面可切换 — 保留 TUI、CLI、HTTP API 多种交互方式

---

## 第三章：能力架构

### 第八条：能力分层

```
┌─────────────────────────────────────────────────────────────┐
│  交互层    TUI / Desktop App / Web UI / VSCode Extension   │
│            / CLI / HTTP API / Slack                        │
├─────────────────────────────────────────────────────────────┤
│  编排层    OpenCode Session Runtime + Plugin Hooks         │
│            （会话运行时调度 LLM 自主调用工具，复杂工作流      │
│             在 Plugin Tool 内部用 TypeScript 代码编排）       │
├─────────────────────────────────────────────────────────────┤
│  专业层    Patent Plugin Tools + Patent Skills             │
│           （可插拔的领域工具集与 Skill 指令集）               │
│            - Patent Search / Analyze / Draft Tools         │
│            - Patent Workflow Skills（多步骤工作流指引）       │
├─────────────────────────────────────────────────────────────┤
│  通用层    File Ops | Shell | Search | Git | Code Edit ... │
│           （保留 OpenCode 全部通用工具）                    │
├─────────────────────────────────────────────────────────────┤
│  基础层    OpenCode Core（TS/Effect）                       │
│            - LLM Client | Session | State | Permission      │
│            - Plugin System | MCP Client | Model Provider    │
│            - Snapshot | SyncEvent | Config                  │
└─────────────────────────────────────────────────────────────┘
```

### 第九条：智能体规范

每个专业智能体以 **Plugin Tool + Skill 指令** 的形式实现，必须定义以下六要素：

1. **身份** — Tool ID、名称、角色描述、专业领域（在 Tool description 和 Skill 中声明）
2. **能力边界** — 能做什么、不能做什么、需要人工确认的边界（Tool 参数 + Permission Hook 控制）
3. **知识来源** — 依赖的法规、案例库、模板、外部数据源（Plugin 内部配置或 MCP Server 提供）
4. **输入/输出规范** — 接受什么格式的输入（Zod Schema），产生什么格式的输出（ToolResult）
5. **质量标准** — 如何验证输出的正确性和专业性（Plugin Tool 内部自建检查逻辑）
6. **审批流程** — 哪些操作需要人工审批（`ctx.ask()` 触发 Permission 系统），哪些可以自动执行（`permission.ask` Hook 自动放行）

所有智能体遵循统一生命周期：`初始化 → 分析 → 建议 → 等待审批 → 执行 → 验证`

> **实现说明**：OpenCode 的 Agent 系统是静态定义的，Plugin 无法注册新 Agent。因此专利"智能体"通过两种方式实现：
> 1. **Plugin Tool** — 暴露具体功能（如 `patent_search`、`patent_draft`），LLM 根据上下文自主决定调用
> 2. **Skill 指令** — 在 `SKILL.md` 中描述多步骤工作流，引导 LLM 按顺序调用相关 Tool
> 
> 复杂编排（如 Drafting Agent 的 5 步骤流程）在 Plugin Tool 内部用 TypeScript async/await 实现，各步骤间通过 `ctx.ask()` 触发审批暂停。

---

### 第十条：智能体详细规范（Phase 1）

> **Plugin 实现映射**：标注每个智能体/工具在 OpenCode Plugin 体系中的实现方案。YunPat 现有模块（`@yunpat/xxx`）需封装为 Plugin Tool 或 MCP Server 接入。

---

#### 10.1 规则研究智能体 (Research Agent)

| 要素 | 定义 |
|------|------|
| **身份** | 知识产权法规与实务研究助手。帮助用户研究特定业务规则（如新业务类型、法规变更、实务操作指南） |
| **能力边界** | ✅ 检索法规条文、审查指南、案例；归纳总结规则要点；对比新旧规则差异<br>❌ 不提供法律意见；不替代专业判断；不处理具体案件 |
| **知识来源** | 中国专利法及实施细则、审查指南、审查操作规程、复审无效案例、法院判例、knowledge-base（4,385 文件） |
| **输入** | 自然语言输入，Agent 内部进行意图识别，拆解为：`{ topic: string, scope?: "法规"｜"案例"｜"实务"｜"全部", depth?: "概述"｜"详细"｜"深度" }`<br>示例："请研究一下关于新用途专利创造性的判定规则" → topic="新用途专利创造性判定"，scope="全部"，depth="详细"<br>示例："请研究功能性技术特征的规则判断" → topic="功能性技术特征判断规则"，scope="法规+实务"，depth="详细" |
| **输出** | 研究报告（Markdown）：背景、相关条文、案例摘要、操作要点、参考来源列表 |
| **质量标准** | 引用的每条法规必须标注具体条款号；案例必须标注案号；不允许无出处的断言 |
| **审批流程** | 全部输出为建议性质，用户自行采纳，无需逐条审批 |
| **Plugin 映射** | `patent_research` Tool（Plugin `Hooks.tool`）封装 `@yunpat/agent-researcher` + `@yunpat/patent-knowledge`（Obsidian 知识库桥接，4,385 文件）+ `@yunpat/unified-knowledge-graph`（统一知识图谱查询）+ MCP Server `patent-knowledge-mcp`（法规/案例库标准化 API）|

**交互流程**：
```
用户: "请研究一下关于新用途专利创造性的判定规则"
  → Agent: [意图识别] 解析研究主题、范围、深度
  → Agent: 确认理解（复述研究意图，确认范围）
  → 用户: 确认或调整
  → Agent: 检索知识库 + 法规库 + 案例库，输出研究报告草案
  → 用户: 审阅、追问、要求补充
  → Agent: 迭代完善
  → 用户: 满意，保存或导出
```

---

#### 10.2 专利撰写智能体 (Drafting Agent)

**本质**：Drafting Agent 不是单一智能体，而是多个子智能体 + 工具的编排流程。由一个编排协调器按 5 个步骤依次调度。

| 要素 | 定义 |
|------|------|
| **身份** | 专利申请文件撰写编排器。从技术交底书出发，协调发明理解、检索、说明书撰写、权利要求撰写、摘要撰写等子智能体，逐步产出完整申请文件 |
| **能力边界** | ✅ 调度子智能体完成发明理解、现有技术检索、说明书撰写、权利要求撰写、摘要撰写；质量检查与迭代优化<br>❌ 不决定权利要求保护范围策略；不签署法律文件；不直接提交申请 |
| **知识来源** | 专利法第2/25/26条、审查指南第二部分、权利要求撰写模板、说明书结构模板、knowledge-base |
| **输入** | `{ disclosure: string ｜ FilePath, patentType: "发明"｜"实用新型", inventionType?: "装置"｜"方法"｜"系统"｜"组合物", existingClaims?: string[] }` |
| **审批流程** | 每个步骤完成后暂停，等待用户确认/修改后才进入下一步骤。权利要求范围的任何修改需用户明确批准 |

**5 步骤流程与子智能体调用**：

##### 步骤 1：发明理解

| 项目 | 说明 |
|------|------|
| 目标 | 从技术交底书中提取结构化的发明理解 |
| 调用子智能体 | InventionUnderstandingAgent |
| 调用工具 | AutoSpecDrafter._understand_invention() |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.3 |
| 输出 | `InventionUnderstanding`：发明名称、类型、技术领域、核心创新点、技术问题、技术方案、技术效果、必要特征、可选特征、置信度 |
| 人机交互 | Agent 展示三元组摘要（技术问题-技术方案-技术效果，<300字），用户确认/修改 |

##### 步骤 2：现有技术检索

| 项目 | 说明 |
|------|------|
| 目标 | 检索现有技术，定位发明点 |
| 调用子智能体 | PatentSearchAgent |
| 调用工具 | MultimodalRetrieval（语义检索）、PatentClassifier（IPC/CPC 分类） |
| 输出 | 对比分析报告（对比文件列表 + 区别特征确认 + 发明点定位） |
| 人机交互 | Agent 展示检索结果摘要（<300字），用户确认检索充分性，可补充/排除对比文件 |

##### 步骤 3：说明书撰写

| 项目 | 说明 |
|------|------|
| 目标 | 基于发明理解和对比分析，撰写说明书各章节 |
| 调用子智能体 | SpecificationAgent |
| 调用工具 | AutoSpecDrafter.draft_specification()、PatentDrawingAnalyzer（附图分析） |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| 输出 | SpecificationDraft：技术领域(50-100字) → 背景技术(300-500字) → 发明内容(800-1500字) → 具体实施方式(1500-3000字) → 附图说明 |
| 人机交互 | 逐章节展示，用户逐章节确认/修改 |
| 质量检查 | 每章节生成后自动 QualityCheck，得分 <7.5 则自动迭代（最多 3 轮），超出转人工 |

##### 步骤 4：权利要求撰写

| 项目 | 说明 |
|------|------|
| 目标 | 基于发明点和说明书，撰写权利要求书 |
| 调用子智能体 | ClaimsAgent、SubjectMatterChecker（保护客体检查） |
| 调用工具 | PatentClaimGenerator（权利要求生成）、ClaimScopeAnalyzer（范围分析） |
| 输出 | ClaimsSet：独立权利要求（中等保护范围）→ 从属权利要求（进一步限定）→ 从属权利要求（具体实现） |
| 人机交互 | 展示权利要求布局规划，用户确认保护范围策略；逐条审阅权利要求 |
| 质量检查 | 清晰性检查（A26.4 符合性）；保护客体适格性检查；范围合理性分析 |
| 模板 | 按发明类型选择：装置模板 / 方法模板 / 系统模板 / 组合物模板 |

##### 步骤 5：摘要撰写与全文整合

| 项目 | 说明 |
|------|------|
| 目标 | 撰写摘要，整合全文，输出完整申请文件 |
| 调用子智能体 | XiaonaPatentDrafter（摘要撰写） |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.3 |
| 输出 | 摘要(300字左右) + 专利申请文件_完整版.md |
| 人机交互 | 展示摘要，用户确认 |

**7 维度质量评估体系**：

| 维度 | 权重 | 阈值 | 说明 |
|------|------|------|------|
| completeness（完整性） | 15% | ≥7.5 | 必要技术特征齐全 |
| clarity（清晰性） | 15% | ≥7.5 | 无歧义用语 |
| accuracy（准确性） | 15% | ≥7.5 | 技术描述准确 |
| sufficiency（充分性 A26.3） | 20% | ≥7.5 | 公开充分 |
| consistency（一致性） | 10% | ≥7.5 | 权利要求与说明书一致 |
| compliance（规范性） | 10% | ≥7.5 | 格式符合要求 |
| support（支持性 A26.4） | 15% | ≥7.5 | 权利要求有说明书支持 |

**质量迭代**：得分 <7.5 自动迭代修复，最多 3 轮，超出转人工审核。

**Plugin 映射**：

| 子智能体/工具 | YunPat 对应 | OpenCode 封装方式 |
|-------------|------------|------------------|
| InventionUnderstandingAgent | `@yunpat/agent-invention` + `DisclosureRefinerAgent` | `patent_draft` Tool（action="understand"），内部调用 `ProfessionalAgent.run()` |
| PatentSearchAgent | `@yunpat/agent-search`（V3）+ `@yunpat/patent-database` | `patent_search` Tool，封装 7500万 CN 专利 + Google Patents API |
| SpecificationAgent | `@yunpat/agent-specification` + `@yunpat/agent-patent-writer`（AutoSpecDrafter） | `patent_draft` Tool（action="specification"），调用 `SpecificationDrafterAgent` |
| ClaimsAgent | `@yunpat/agent-claims` + `PatentClaimGenerator` | `patent_draft` Tool（action="claims"），调用 `ClaimGeneratorAgent` |
| SubjectMatterChecker | `@yunpat/agent-subject-matter-checker` | `patent_check` Tool（action="subject_matter"）|
| QualityCheckerAgent | `@yunpat/agent-quality`（EnhancedQualityCheckerAgent） | `patent_check` Tool（action="quality"），7 维度评估 |
| XiaonaPatentDrafter | `@yunpat/agent-patent-writer` | `patent_draft` Tool（action="integrate"），调用 `PatentWriterAgent` |
| ClaimScopeAnalyzer | YunPat 辅助分析模块 | `patent_analyze` Tool（action="scope"）|
| PatentDrawingAnalyzer | `@yunpat/agent-image-understanding`（DrawingUnderstandingAgent）| `patent_analyze` Tool（action="drawing"），多模态模型分析附图 |
| MultimodalRetrieval | `@yunpat/patent-database` + `@yunpat/rust-tools` 向量服务 | `patent_search` Tool 内部语义检索，调用 EmbeddingAdapter + pgvector |

**交互流程**：
```
用户: 提交技术交底书（文件或文本）
  → Agent: [步骤1-发明理解] 输出三元组摘要，请求确认
  → 用户: 确认/修正技术要点
  → Agent: [步骤2-现有技术检索] 输出检索结果和对比分析
  → 用户: 确认检索充分性，补充/排除对比文件
  → Agent: [步骤3-说明书撰写] 逐章节生成，每章节自动质量检查
    ↻ 质量不达标时自动迭代（≤3轮）
  → 用户: 逐章节审阅修改
  → Agent: [步骤4-权利要求撰写] 展示布局规划 + 保护客体检查
  → 用户: 确认保护范围策略，审阅权利要求
  → Agent: [步骤5-摘要+整合] 输出完整申请文件
  → 用户: 最终确认
```

---

#### 10.3 审查意见答辩智能体 (OA Response Agent)

**本质**：OA Response Agent 不是单一智能体，而是多个子智能体 + 工具的编排流程。由一个编排协调器按 5 个步骤依次调度，覆盖审查意见通知书的全流程答辩。

| 要素 | 定义 |
|------|------|
| **身份** | 审查意见（Office Action）分析与答辩编排器。从审查意见通知书出发，协调解析、深度分析、策略制定、文本撰写、验证打包等子智能体，逐步产出完整答辩文件 |
| **能力边界** | ✅ 解析审查意见要点（引用条款、对比文件、驳回理由）；检索相关案例和复审决定；模拟审查员视角分析；生成多方案答辩策略建议；撰写意见陈述书草案；生成权利要求修改建议；验证答复完整性<br>❌ 不决定最终答辩策略；不直接提交答辩文件；不预测审查结果 |
| **知识来源** | 审查指南（实质审查部分）、专利法第22/33条、审查意见历史数据、复审无效案例库、对比文件全文、knowledge-base |
| **输入** | `{ officeAction: string ｜ FilePath, applicationClaims: string[], priorArtReferences?: string[], prosecutionHistory?: string[] }` |
| **审批流程** | 策略选择必须用户决定（Agent 提供选项和利弊分析）；答辩文件定稿必须用户确认；权利要求修改必须用户逐条批准 |

**5 种驳回理由类型**：

| 驳回理由 | 法律依据 | 严重程度 | 分析框架 |
|---------|---------|---------|---------|
| 新颖性问题 | A22.2 | 中 | 三元组逐一比对（技术领域/技术方案/区别特征） |
| 创造性问题 | A22.3 | 严重 | 三步法（最接近现有技术→区别特征→技术启示→效果） |
| 公开不充分 | A26.3 | 严重 | 实施方案检验（完整性/充分性/可预期性） |
| 权利要求不清楚 | A26.4 | 中 | 保护范围明确性检查 |
| 修改超范围 | A33 | 严重 | 原始公开范围对照 |

**5 步骤流程与子智能体调用**：

##### 步骤 1：审查意见解读与问题分解

| 项目 | 说明 |
|------|------|
| 目标 | 从审查意见通知书中提取结构化数据，识别所有驳回理由 |
| 调用子智能体 | OfficeActionParser（OA 文档结构化解析） |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.2 |
| 输出 | `OfficeAction`：OA编号、申请号、驳回类型、驳回理由、对比文件列表、被引权利要求、审查员论点、缺失技术特征、答复期限 |
| 人机交互 | Agent 展示驳回理由清单摘要（<300字），用户确认解析是否完整准确 |

##### 步骤 2：驳回理由深度分析

| 项目 | 说明 |
|------|------|
| 目标 | 针对每个驳回理由进行深度技术-法律分析，生成对比分析报告 |
| 调用子智能体 | SmartOAResponder（核心分析）、ExaminerSimulator（审查员视角模拟） |
| 分析框架 | 新颖性→三元组逐一比对；创造性→三步法分析；公开不充分→实施方案检验；不清楚→范围明确性；超范围→原始公开对照 |
| 输出 | 对比分析报告：每个驳回理由的问题-特征-效果三元组分析、与每篇对比文件的逐一对比、综合判断（完全公开/部分公开/未公开） |
| 人机交互 | Agent 展示分析结果摘要（<300字），用户确认技术理解，可修正分析 |

##### 步骤 3：答复策略制定

| 项目 | 说明 |
|------|------|
| 目标 | 基于深度分析结果，制定多个可选答复策略并评估成功率和风险 |
| 调用子智能体 | SmartOAResponder（策略生成）、HebbianOptimizer（案例学习优化） |
| 策略类型 | 完全反驳 / 部分反驳+修改 / 完全接受+修改 / 组合策略 |
| 输出 | `ResponsePlan`：各策略的修改内容、保护范围影响、成功概率、风险评估的多方案对比表 |
| 人机交互 | Agent 展示方案对比表，用户选择策略（可组合或自定义）**← 关键决策点** |

**策略选择参考矩阵**：

| 场景 | 推荐策略 | 成功概率 | 风险等级 |
|------|---------|---------|---------|
| 审查员观点明显错误 | 完全反驳 | ~70% | 中 |
| 部分认可，可修改克服 | 部分反驳+修改 | ~85% | 低 |
| 完全认可，需缩小保护范围 | 完全接受+修改 | ~95% | 极低 |
| 多个驳回理由组合 | 组合策略 | ~75% | 中 |

##### 步骤 4：答复文本撰写

| 项目 | 说明 |
|------|------|
| 目标 | 基于选定策略，撰写意见陈述书和权利要求修改文本 |
| 调用子智能体 | ClaimReviser（权利要求修订）、OAResponseValidator（答复验证） |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| 输出 | 意见陈述书（逐驳回理由结构化）+ 修改后权利要求书（含修改对照标注） |
| 循环 | 对每个驳回理由逐一撰写，每条完成后用户审阅 |
| 人机交互 | 逐条展示答复内容，用户审阅修改；权利要求修改逐条批准 |
| 质量检查 | 自动验证：答辩理由法律依据引用完整性、修改不超范围、格式符合国知局要求 |

**意见陈述书结构**：
```
一、关于驳回理由N（类型）
  1. 审查员观点概述
  2. 申请人的意见（逐条回应）
  3. 技术对比分析（详细对比表）
  4. 法律依据（法条和审查指南引用）
  5. 结论（明确请求）
二、权利要求修改说明
  修改依据 + 修改内容标注 + 修改后文本
```

##### 步骤 5：验证与打包

| 项目 | 说明 |
|------|------|
| 目标 | 验证答复完整性，生成可提交的答复文件包 |
| 调用子智能体 | OAResponseValidator（完整性验证） |
| 输出 | 答复文件清单：意见陈述书 + 修改后权利要求书 + 修改替换页 |
| 质量检查 | 格式检查、一致性检查（意见陈述书与修改对照）、完整性检查（所有驳回理由均已回应） |
| 人机交互 | 展示完整答复包，用户最终确认提交 |

**Plugin 映射**：

| 子智能体/工具 | YunPat 对应 | OpenCode 封装方式 |
|-------------|------------|------------------|
| OfficeActionParser | `@yunpat/patent-core`（OA 文档解析） | `oa_analyze` Tool（action="parse"），PDF/DOCX 解析 + 结构化提取 |
| SmartOAResponder | `@yunpat/agent-patent-responder`（V5，集成真实数据库） | `oa_response` Tool（action="respond"），调用 `PatentResponderAgentV5` |
| ExaminerSimulator | `@yunpat/agent-patent-responder`（审查员模拟模块） | `oa_response` Tool（action="simulate"），模拟审查员视角 |
| ClaimReviser | `@yunpat/agent-patent-responder`（权利要求修订模块） | `oa_response` Tool（action="revise_claims"），生成修改对照表 |
| OAResponseValidator | `@yunpat/agent-patent-responder`（答复验证模块） | `oa_response` Tool（action="validate"），完整性 + 格式检查 |
| HebbianOptimizer | `@yunpat/core` 案例学习模块 | `oa_response` Tool 内部案例推荐，调用 `KnowledgeEnhancedAgent` |
| PatentSearchAgent | `@yunpat/agent-search`（V3，对比文件检索） | `patent_search` Tool，检索对比文件 |
| PatentAnalyzerAgent | `@yunpat/agent-patent-analyzer`（V2，技术对比分析） | `patent_analyze` Tool（action="compare"），特征对比矩阵 |

**交互流程**：
```
用户: 提交审查意见通知书
  → Agent: [步骤1-解读] 输出驳回理由清单，请求确认
  → 用户: 确认解析完整/补充说明
  → Agent: [步骤2-深度分析] 输出对比分析报告
  → 用户: 确认技术理解/修正分析
  → Agent: [步骤3-策略制定] 输出多方案对比表 ← 关键决策点
  → 用户: 选择策略（可组合或自定义）
  → Agent: [步骤4-文本撰写] 逐驳回理由撰写
    ↻ 每条完成后用户审阅修改
  → Agent: [步骤5-验证打包] 输出完整答复文件包
  → 用户: 最终确认提交
```

---

#### 10.4 专利复审智能体 (Reexamination Agent)

**本质**：Reexamination Agent 不是单一智能体，而是多个子智能体 + 工具的编排流程。由一个编排协调器按 5 个步骤依次调度，覆盖从驳回决定分析到复审请求提交的全流程。

**程序性质**：行政救济程序。申请人收到驳回决定后 3 个月内提出，由专利复审和无效审理部审理。

| 要素 | 定义 |
|------|------|
| **身份** | 专利复审请求编排器。从驳回决定出发，协调驳回分析、补充检索、策略制定、文书撰写、程序跟踪等子智能体，逐步产出完整复审请求文件 |
| **能力边界** | ✅ 解析驳回决定要点（驳回类型、审查员论点、对比文件）；补充检索对比文件和非专利文献；分析驳回逻辑链各环节强弱；检索复审成功先例；生成多方案复审策略；撰写复审请求书草案；修改权利要求建议；跟踪前置审查/合议审查进程<br>❌ 不决定复审策略（是否修改权利要求、修改幅度）；不预测复审结果；不直接提交复审请求 |
| **知识来源** | 专利法第41条、实施细则第60-63条、审查指南第四部分第二章、复审委员会决定案例、knowledge-base |
| **输入** | `{ rejectionDecision: string ｜ FilePath, applicationFile?: string ｜ FilePath, prosecutionHistory?: string[] }` |
| **审批流程** | 驳回分析确认 → 策略选择由用户决定 → 请求书定稿用户确认 → 权利要求修改逐条批准 |

**5 步骤流程与子智能体调用**：

##### 步骤 1：驳回决定分析

| 项目 | 说明 |
|------|------|
| 目标 | 从驳回决定中提取结构化数据，识别所有驳回理由及其逻辑链 |
| 调用子智能体 | AnalyzerAgent（驳回分析） |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.2 |
| 输出 | 驳回理由清单：驳回类型（A22.2/A22.3/A26.3/A26.4/A33）、审查员论点、对比文件引用、被引权利要求、各环节逻辑强弱标注 |
| 人机交互 | Agent 展示驳回理由清单摘要（<300字），用户确认理解是否准确 |

##### 步骤 2：补充检索

| 项目 | 说明 |
|------|------|
| 目标 | 补充对比文件和非专利文献，为复审论证提供更充分的证据基础 |
| 调用子智能体 | RetrieverAgent（检索代理） |
| 输出 | 补充对比文件集合 + 非专利文献 + 证据说服力评估 |
| 人机交互 | Agent 展示检索结果摘要，用户确认检索充分性，可补充/排除 |

##### 步骤 3：复审策略制定

| 项目 | 说明 |
|------|------|
| 目标 | 评估各驳回理由的可争辩性，制定复审策略 |
| 调用子智能体 | PatentAnalyzerAgent（可争辩性评估）+ NoveltyAnalyzerAgent/CreativityAnalyzerAgent（按驳回类型） |
| 策略选项 | 完全争辩（成功率 >70%）/ 修改+争辩（成功率 50-70%）/ 接受驳回建议（成功率 <50%） |
| 输出 | 复审策略方案：各策略的论证要点、修改内容（如需）、成功概率评估、风险评估 |
| 人机交互 | Agent 展示策略选项及利弊分析，用户选择策略 **← 关键决策点** |

**程序参考数据**：前置审查约 30% 直接撤销驳回；合议审查成功率约 40-50%。

##### 步骤 4：复审请求书撰写

| 项目 | 说明 |
|------|------|
| 目标 | 基于选定策略，撰写复审请求书和权利要求修改文本（如需） |
| 调用子智能体 | WriterAgent（文书撰写）、ClaimReviser（权利要求修订，如采用修改策略） |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| 输出 | 复审请求书草案 + 修改后权利要求（如策略需要） |
| 人机交互 | 逐节展示请求书内容，用户审阅修改；权利要求修改逐条批准 |
| 质量检查 | 复审理由法律依据引用完整性；修改不超范围（可从原申请文件直接地、毫无疑义地确定）；引用复审先例可追溯 |

**复审请求书论证框架**：
```
一、对驳回理由的总体回应
  - 指出审查员在事实认定或法律适用上的错误
  - 提出新的证据或解释
二、针对新颖性驳回（A22.2）
  - 强调区别特征 + "单独对比"原则
三、针对创造性驳回（A22.3）
  - 重新确定最接近现有技术 → 认定区别特征 → 反驳技术启示 → 预料不到的技术效果
四、针对其他驳回理由
  - A26.3: 补充实验数据/详细说明
  - A26.4: 澄清术语定义
  - A33: 证明修改可从原文直接地、毫无疑义地确定
五、修改说明（如修改了权利要求）
  - 修改依据（实施细则第60条）+ 修改内容 + 如何克服驳回理由
```

##### 步骤 5：验证与程序跟踪

| 项目 | 说明 |
|------|------|
| 目标 | 验证复审请求文件完整性，跟踪后续审查程序 |
| 调用子智能体 | QualityCheckerAgent（完整性验证） |
| 输出 | 完整复审请求文件包 + 时限提醒（法定期限、答复期限） |
| 程序跟踪 | 前置审查结果 → 合议审查（如进入）→ 复审决定（维持驳回/撤销驳回） |
| 后续路径 | 维持驳回 → 行政诉讼（北京知识产权法院）；撤销驳回 → 继续审查/授权 |
| 人机交互 | 展示完整文件包，用户最终确认提交 |

**Plugin 映射**：

| 子智能体/工具 | YunPat 对应 | OpenCode 封装方式 |
|-------------|------------|------------------|
| AnalyzerAgent（驳回分析） | `@yunpat/agent-patent-analyzer`（V2） | `reexam_analyze` Tool（action="analyze_rejection"）|
| RetrieverAgent（检索） | `@yunpat/agent-search`（V3） | `patent_search` Tool，补充检索对比文件和非专利文献 |
| NoveltyAnalyzerAgent | `@yunpat/agent-patent-analyzer`（新颖性分析模块） | `reexam_analyze` Tool（action="novelty"），单独对比原则分析 |
| CreativityAnalyzerAgent | `@yunpat/agent-patent-analyzer`（创造性分析模块） | `reexam_analyze` Tool（action="creativity"），三步法分析 |
| WriterAgent（撰写） | `@yunpat/agent-patent-writer` | `reexam_draft` Tool，调用 `PatentWriterAgent` 撰写复审请求书 |
| ClaimReviser | `@yunpat/agent-patent-responder`（权利要求修订模块） | `reexam_draft` Tool（action="revise_claims"）|
| QualityCheckerAgent | `@yunpat/agent-quality` | `patent_check` Tool（action="quality"）|
| PatentSearchAgent | `@yunpat/agent-search`（复审先例检索） | `patent_search` Tool，检索复审成功先例 |

**交互流程**：
```
用户: 提交驳回决定
  → Agent: [步骤1-驳回分析] 输出驳回理由清单+逻辑链强弱标注
  → 用户: 确认理解准确
  → Agent: [步骤2-补充检索] 输出补充对比文件和非专利文献
  → 用户: 确认检索充分性
  → Agent: [步骤3-策略制定] 输出策略选项（争辩/修改+争辩/接受） ← 关键决策点
  → 用户: 选择策略
  → Agent: [步骤4-文书撰写] 逐节撰写复审请求书 + 权利要求修改（如需）
    ↻ 每节完成后用户审阅修改
  → Agent: [步骤5-验证跟踪] 输出完整文件包 + 时限提醒
  → 用户: 最终确认提交
```

---

#### 10.5 专利无效宣告智能体 (Invalidation Agent)

**本质**：Invalidation Agent 不是单一智能体，而是多个子智能体 + 工具的编排流程。由一个编排协调器按 5 个步骤依次调度，覆盖从目标专利分析到无效宣告请求书撰写的全流程。

**程序性质**：行政确权程序。任何单位/个人对已授权专利提出，由专利复审和无效审理部审理，以口审程序为主。

| 要素 | 定义 |
|------|------|
| **身份** | 专利无效宣告请求编排器。从目标专利出发，协调技术分析、证据收集、新颖性/创造性挑战分析、策略制定、文书撰写等子智能体，逐步产出完整无效宣告请求文件 |
| **能力边界** | ✅ 分析目标专利权利要求和说明书（特征提取、保护范围界定、弱点识别）；检索对比文件（专利文献+非专利文献+公开使用证据）；证据真实性验证；特征对比分析；新颖性挑战分析（单独对比原则）；创造性挑战分析（三步法）；无效理由组合优化；证据链构建；撰写无效宣告请求书草案<br>❌ 不决定无效策略（攻击哪些权利要求、使用哪些证据组合）；不预测无效结果；不直接提交无效请求 |
| **知识来源** | 专利法第2/5/9/22/25/26/33/45/46条、实施细则、审查指南第四部分、无效宣告决定案例库、knowledge-base |
| **输入** | `{ targetPatent: string ｜ FilePath ｜ PatentNumber, invalidationGrounds?: ("新颖性"｜"创造性"｜"充分公开"｜"不清楚"｜"修改超范围"｜"不属于授权客体"｜"重复授权")[] }` |
| **审批流程** | 证据收集用户确认充分性 → 无效策略和证据组合用户决定 → 请求书定稿用户确认 |

**无效理由体系**：

| 无效理由 | 法律依据 | 实务成功率 | 分析框架 |
|---------|---------|----------|---------|
| 新颖性 | A22.2 | 中-高 | 单独对比原则：一篇对比文件公开全部特征 |
| 创造性 | A22.3 | 中 | 三步法：最接近现有技术→区别特征→技术启示→显而易见性 |
| 公开不充分 | A26.3 | 中 | 说明书不清楚/不完整/无法实现 |
| 权利要求不清楚 | A26.4 | 中 | 保护范围不明确 |
| 修改超范围 | A33 | 中 | 修改内容超出原始公开范围 |
| 不属于授权客体 | A2/A5/A25 | 低 | 科学发现、智力活动规则等 |
| 重复授权 | A9 | 低 | 同样的发明创造被授予多项专利权 |

**5 步骤流程与子智能体调用**：

##### 步骤 1：目标专利技术分析

| 项目 | 说明 |
|------|------|
| 目标 | 从目标专利中提取结构化技术特征，界定保护范围，识别弱点 |
| 调用子智能体 | AnalyzerAgent（分析代理） |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.2 |
| 输出 | 专利技术分析报告：权利要求特征提取（独立/从属分解）、保护范围界定、技术方案结构化、弱点识别（保护范围过宽、特征易规避等） |
| 人机交互 | Agent 展示技术分析摘要（<300字），用户确认理解 |

##### 步骤 2：证据收集和筛选

| 项目 | 说明 |
|------|------|
| 目标 | 检索对比文件和非专利文献，收集证据，评估证据质量 |
| 调用子智能体 | RetrieverAgent（检索代理） |
| 检索范围 | 专利文献（D1, D2...）、非专利文献、公开使用证据、公知常识证据（教科书/技术手册） |
| 输出 | 证据清单：对比文件集合 + 相关性排序（BM25 + 语义相似度）+ 专利家族去重 + 证据真实性评估 |
| 人机交互 | Agent 展示检索结果和证据清单，用户确认检索充分性，补充/排除证据 |

##### 步骤 3：无效理由分析

| 项目 | 说明 |
|------|------|
| 目标 | 基于证据对目标专利进行多维度无效理由分析 |
| 调用子智能体 | NoveltyAnalyzerAgent（新颖性）、CreativityAnalyzerAgent（创造性）、AnalyzerAgent（其他理由） |
| 新颖性分析 | 单独对比原则：将权利要求与每篇对比文件逐一比对，确认特征是否被公开 |
| 创造性分析 | 三步法：① 确定最接近现有技术（技术领域相同/公开特征最多）→ ② 确定区别特征和实际解决的技术问题 → ③ 判断显而易见性（其他对比文件是否公开区别特征、是否存在技术启示、区别特征是否起相同作用） |
| 其他理由 | A26.3/A26.4/A33/A2/A5/A25/A9 按需分析 |
| 输出 | 各无效理由的分析结果 + 特征对比矩阵 + 各理由成功率评估 |
| 人机交互 | Agent 展示分析结果摘要，用户确认对比准确性 |

##### 步骤 4：策略制定

| 项目 | 说明 |
|------|------|
| 目标 | 优化无效理由组合，构建证据链，制定攻击策略 |
| 调用子智能体 | InvalidationAnalyzerAgent（无效策略专家） |
| 策略内容 | 无效理由组合优化（选择最具说服力的理由组合）、证据链构建（证据组×攻击目标映射）、攻击优先级排序 |
| 输出 | 无效宣告策略方案：理由组合 + 证据链 + 各组合成功率评估 + 风险评估 |
| 人机交互 | Agent 展示策略方案，用户选择攻击策略 **← 关键决策点** |

**证据链构建框架**：
```
├─ 证据组1：新颖性攻击
│   ├─ D1 → 公开权利要求1全部特征
│   └─ D2 → 公开从属权利要求附加特征
├─ 证据组2：创造性攻击
│   ├─ D1（最接近现有技术）→ 公开大部分特征
│   ├─ D2 → 公开区别技术特征
│   └─ D3 / 公知常识 → 提供结合启示
├─ 证据组3：形式缺陷攻击
│   ├─ A26.3：说明书未充分公开
│   ├─ A26.4：权利要求不清楚
│   └─ A33：修改超出原始公开
└─ 辅助证据：教科书、行业标准、专家证言
```

##### 步骤 5：文书撰写与验证

| 项目 | 说明 |
|------|------|
| 目标 | 撰写无效宣告请求书，整理证据清单，验证完整性 |
| 调用子智能体 | WriterAgent（撰写）、QualityCheckerAgent（验证） |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| 输出 | 无效宣告请求书（逐条理由含特征对比表）+ 证据清单（含证明目的）+ 附件清单 |
| 质量检查 | 证据充分性（无重大遗漏）；特征对比基于原文不臆断；无效理由有法律和事实支撑；证据链完整 |
| 人机交互 | 展示完整请求书，用户审阅修改，最终确认提交 |

**无效宣告请求书结构**：
```
一、请求人信息 / 专利权人信息
二、无效宣告理由（逐条）
  理由N：权利要求X不具备Y性（法律依据）
    - 对比文件
    - 特征对比表（权利要求特征 vs 对比文件公开内容 vs 对比结果）
    - 结论
三、证据清单（证据编号/名称/形式/证明目的/页数）
四、附件
```

**Plugin 映射**：

| 子智能体/工具 | YunPat 对应 | OpenCode 封装方式 |
|-------------|------------|------------------|
| AnalyzerAgent（目标分析） | `@yunpat/agent-patent-analyzer`（V2） | `invalidation_analyze` Tool（action="analyze_target"），特征提取 + 保护范围界定 + 弱点识别 |
| RetrieverAgent（证据检索） | `@yunpat/agent-search`（V3） | `patent_search` Tool，检索专利文献 + 非专利文献 + 公知常识证据 |
| NoveltyAnalyzerAgent | `@yunpat/agent-patent-analyzer`（新颖性分析模块） | `invalidation_analyze` Tool（action="novelty"），单独对比原则 |
| CreativityAnalyzerAgent | `@yunpat/agent-patent-analyzer`（创造性分析模块） | `invalidation_analyze` Tool（action="creativity"），三步法 + 显而易见性判断 |
| InvalidationAnalyzerAgent | `@yunpat/agent-patent-analyzer`（无效策略专家模块） | `invalidation_analyze` Tool（action="strategy"），理由组合优化 + 证据链构建 |
| WriterAgent（撰写） | `@yunpat/agent-patent-writer` | `invalidation_draft` Tool，撰写无效宣告请求书 |
| QualityCheckerAgent | `@yunpat/agent-quality` | `patent_check` Tool（action="quality"）|
| PatentSearchAgent | `@yunpat/agent-search`（无效先例检索） | `patent_search` Tool，检索无效宣告先例 |
| InfringementAnalyzerAgent | `@yunpat/agent-patent-analyzer`（权利要求解释模块） | `invalidation_analyze` Tool（action="claim_interpretation"），最宽合理解释原则 |

**交互流程**：
```
用户: 提交目标专利号/文件
  → Agent: [步骤1-技术分析] 输出权利要求特征分解+保护范围+弱点识别
  → 用户: 确认理解
  → Agent: [步骤2-证据收集] 输出证据清单（专利文献+非专利文献+公知常识）
  → 用户: 确认检索充分性，补充/排除证据
  → Agent: [步骤3-理由分析] 新颖性(单独对比) + 创造性(三步法) + 其他理由分析
  → 用户: 确认对比准确性
  → Agent: [步骤4-策略制定] 输出理由组合+证据链+成功率评估 ← 关键决策点
  → 用户: 选择攻击策略
  → Agent: [步骤5-文书撰写] 逐条撰写无效宣告请求书 + 证据清单
  → 用户: 审阅修改，最终确认提交
```

---

#### 10.6 共享智能体规范

以下智能体解决特定任务（非编排协调），作为基础服务被多个场景智能体共享。按功能分为 5 类。

##### 检索类

**PatentSearchAgent（检索代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 专利文献检索、非专利文献检索、证据收集和相关性排序 |
| 输入 | `{ query: string, scope: "patent"｜"non_patent"｜"all", filters?: { dateRange?, ipcClass?, keyword? }, maxResults?: number }` |
| 输出 | `SearchResult[]`：对比文件集合（编号、标题、公开日、摘要、相关性评分）+ 专利家族去重 |
| 推荐模型 | 不直接使用 LLM（检索引擎驱动），结果排序可用轻量模型辅助 |
| Plugin 映射 | `@yunpat/agent-search`（V3）（封装为OpenCode Plugin Tool）|
| 使用者 | Drafting, OA Response, Reexamination, Invalidation, Research |

##### 分析类

**PatentAnalyzerAgent（技术分析代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 技术特征提取、保护范围界定、弱点识别、技术方案结构化 |
| 输入 | `{ patentDocument: string ｜ FilePath, analysisType: "feature_extraction"｜"scope_analysis"｜"weakness" }` |
| 输出 | `AnalysisReport`：权利要求特征列表（独立/从属分解）、保护范围界定、弱点标注 |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.2 |
| Plugin 映射 | `@yunpat/agent-patent-analyzer`（V2）（封装为OpenCode Plugin Tool）|
| 使用者 | OA Response, Reexamination, Invalidation |

**NoveltyAnalyzerAgent（新颖性分析代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 基于单独对比原则的新颖性判断 |
| 输入 | `{ claim: string, priorArt: PriorArtDocument, claimType: "independent"｜"dependent" }` |
| 输出 | `NoveltyAnalysis`：逐特征对比表（权利要求特征 vs 对比文件公开内容 → 公开/未公开）+ 综合判断（完全公开/部分公开/未公开） |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.2 |
| Plugin 映射 | `@yunpat/agent-patent-analyzer`（新颖性分析模块）（封装为OpenCode Plugin Tool）|
| 使用者 | Reexamination, Invalidation |

**CreativityAnalyzerAgent（创造性分析代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 基于三步法的创造性判断 |
| 输入 | `{ claim: string, closestPriorArt: PriorArtDocument, secondaryReferences?: PriorArtDocument[] }` |
| 输出 | `CreativityAnalysis`：① 最接近现有技术确定 → ② 区别特征和实际解决的技术问题 → ③ 显而易见性判断（技术启示分析 + 辅助因素）+ 结论 |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.2 |
| Plugin 映射 | `@yunpat/agent-patent-analyzer`（创造性分析模块）（封装为OpenCode Plugin Tool）|
| 使用者 | Reexamination, Invalidation |

**InventionUnderstandingAgent（发明理解代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 从技术交底书中提取结构化的发明理解 |
| 输入 | `{ disclosure: string ｜ FilePath, patentType?: "发明"｜"实用新型" }` |
| 输出 | `InventionUnderstanding`：发明名称、类型、技术领域、核心创新点、技术问题、技术方案、技术效果、必要特征、可选特征、置信度 |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.3 |
| Plugin 映射 | `@yunpat/agent-invention`（封装为OpenCode Plugin Tool）|
| 使用者 | Drafting（Phase 2 全流程管理可能复用） |

**SubjectMatterChecker（保护客体检查代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 检查权利要求是否属于可授权客体 |
| 输入 | `{ claims: string[], inventionType: string }` |
| 输出 | `SubjectMatterCheck`：每条权利要求的客体适格性（通过/不通过/需修改）+ 法律依据（A2/A5/A25）+ 修改建议 |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.2 |
| Plugin 映射 | `@yunpat/agent-subject-matter-checker`（封装为OpenCode Plugin Tool）|
| 使用者 | Drafting |

**OfficeActionParser（OA 文档解析代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 解析审查意见通知书，提取结构化数据 |
| 输入 | `{ document: string ｜ FilePath }` |
| 输出 | `OfficeAction`：OA编号、申请号、驳回类型（A22.2/A22.3/A26.3/A26.4/A33）、驳回理由、对比文件列表、被引权利要求、审查员论点、缺失技术特征、答复期限 |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.2 |
| Plugin 映射 | `@yunpat/patent-core`（OA 文档解析）（封装为OpenCode Plugin Tool）|
| 使用者 | OA Response |

**ExaminerSimulator（审查员模拟代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 模拟审查员视角，预判可能的反驳和关注点 |
| 输入 | `{ application: string, priorArt: PriorArtDocument[], analysisType: "novelty"｜"creativity"｜"full" }` |
| 输出 | `ExaminerPerspective`：审查员可能的反驳论点、关注的技术问题、可能的审查结论建议 |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.5 |
| Plugin 映射 | `@yunpat/agent-patent-responder`（审查员模拟模块）（封装为OpenCode Plugin Tool）|
| 使用者 | OA Response |

**InvalidationAnalyzerAgent（无效分析代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 无效理由组合分析、证据链构建、攻击策略优化 |
| 输入 | `{ targetPatent: AnalysisReport, evidence: SearchResult[], grounds: InvalidationGround[] }` |
| 输出 | `InvalidationStrategy`：理由组合方案 + 证据链（证据组×攻击目标映射）+ 各组合成功率评估 |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| Plugin 映射 | YunPat 无效分析专用模块（封装为OpenCode Plugin Tool）|
| 使用者 | Invalidation |

**SmartOAResponder（OA 核心分析代理）**

| 项目 | 说明 |
|------|------|
| 职责 | OA 驳回理由深度分析和答复策略生成 |
| 输入 | `{ officeAction: OfficeAction, priorArt: PriorArtDocument[], mode: "analyze"｜"plan_response" }` |
| 输出 | analyze 模式：`ComparisonReport`（三元组对比分析）；plan_response 模式：`ResponsePlan`（多方案策略对比表） |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| Plugin 映射 | `@yunpat/agent-patent-responder`（V5）（封装为OpenCode Plugin Tool）|
| 使用者 | OA Response |

##### 撰写类

**WriterAgent（法律文书撰写代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 撰写复审请求书、无效宣告请求书等法律文书 |
| 输入 | `{ documentType: "reexamination_request"｜"invalidation_request"｜"response_statement", strategy: Strategy, evidence: Evidence[], template?: string }` |
| 输出 | `LegalDocument`：结构化法律文书（Markdown）+ 证据清单 + 附件清单 |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| Plugin 映射 | `@yunpat/agent-patent-writer`（封装为OpenCode Plugin Tool）|
| 使用者 | Reexamination, Invalidation |

**ClaimReviser（权利要求修订代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 修改权利要求，生成修改对照标注 |
| 输入 | `{ originalClaims: string[], modificationBasis: "specification"｜"original_filing", strategy: string, allowedModifications?: string[] }` |
| 输出 | `RevisedClaims`：修改后权利要求全文 + 修改对照表（原文 vs 修改后 + 修改依据） |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| Plugin 映射 | `@yunpat/agent-patent-responder`（权利要求修订模块）（封装为OpenCode Plugin Tool）|
| 使用者 | OA Response, Reexamination |

**SpecificationAgent（说明书撰写代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 撰写说明书各章节 |
| 输入 | `{ invention: InventionUnderstanding, comparison: ComparisonReport, patentType: string }` |
| 输出 | `SpecificationDraft`：技术领域 → 背景技术 → 发明内容 → 具体实施方式 → 附图说明 |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| Plugin 映射 | `@yunpat/agent-specification` + `@yunpat/agent-patent-writer`（封装为OpenCode Plugin Tool）|
| 使用者 | Drafting |

**ClaimsAgent（权利要求撰写代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 撰写权利要求书 |
| 输入 | `{ invention: InventionUnderstanding, specification: SpecificationDraft, type: "装置"｜"方法"｜"系统"｜"组合物" }` |
| 输出 | `ClaimsSet`：独立权利要求 + 从属权利要求（分层布局） |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.3 |
| Plugin 映射 | `@yunpat/agent-claims`（封装为OpenCode Plugin Tool）|
| 使用者 | Drafting |

##### 质量与验证类

**QualityCheckerAgent（质量检查代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 专利文件 7 维度质量评估（completeness/clarity/accuracy/sufficiency/consistency/compliance/support） |
| 输入 | `{ document: string ｜ FilePath, documentType: "specification"｜"claims"｜"response"｜"reexamination"｜"invalidation", checkDimensions?: string[] }` |
| 输出 | `QualityReport`：各维度得分（0-10）+ 权重综合得分 + 不达标项修复建议；阈值 ≥7.5 |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.2 |
| Plugin 映射 | `@yunpat/agent-quality`（封装为OpenCode Plugin Tool）|
| 使用者 | Drafting, OA Response, Reexamination, Invalidation |

**OAResponseValidator（OA 答复验证代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 验证答复文件的完整性、格式合规性、一致性 |
| 输入 | `{ responseStatement: string, revisedClaims: string, officeAction: OfficeAction }` |
| 输出 | `ValidationResult`：通过/不通过 + 各检查项结果（格式/一致性/完整性/修改不超范围） |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.1 |
| Plugin 映射 | `@yunpat/agent-patent-responder`（答复验证模块）（封装为OpenCode Plugin Tool）|
| 使用者 | OA Response |

##### 辅助类

**HebbianOptimizer（案例学习代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 从历史成功/失败案例中学习，优化策略推荐 |
| 输入 | `{ currentCase: CaseFeatures, caseDatabase: CaseDatabase }` |
| 输出 | `StrategyRecommendation`：相似案例（Top-K）+ 成功策略 + 权重调整建议 |
| 推荐模型 | 不直接使用 LLM（检索+统计驱动） |
| Plugin 映射 | YunPat 案例学习优化模块（封装为OpenCode Plugin Tool）|
| 使用者 | OA Response |

**DisclosureRefinerAgent（交底精炼代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 精炼和补全技术交底书 |
| 输入 | `{ disclosure: string ｜ FilePath }` |
| 输出 | `RefinedDisclosure`：补全后的交底书 + 缺失信息提示 + 建议补充项 |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.3 |
| Plugin 映射 | `@yunpat/agent-analysis/DisclosureRefinerAgent`（封装为OpenCode Plugin Tool）|
| 使用者 | Drafting |

**ComparisonReportGenerator（对比报告生成代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 生成特征对比分析报告 |
| 输入 | `{ target: ClaimSet, priorArt: PriorArtDocument[], comparisonType: "novelty"｜"creativity"｜"full" }` |
| 输出 | `ComparisonReport`：逐特征对比表 + 区别特征汇总 + 发明点定位 |
| 推荐模型 | 轻量快速模型（如 qwen3.5），temperature=0.2 |
| Plugin 映射 | `@yunpat/agent-analysis/ComparisonReportGeneratorAgent`（封装为OpenCode Plugin Tool）|
| 使用者 | Invalidation, OA Response |

**InfringementAnalyzerAgent（侵权分析代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 权利要求解释和侵权判定（辅助无效分析中的权利要求解释） |
| 输入 | `{ claims: string[], accusedProduct?: string }` |
| 输出 | `InfringementAnalysis`：权利要求解释（最宽合理解释原则）+ 技术特征分解 |
| 推荐模型 | 深度推理模型（如 deepseek-reasoner），temperature=0.2 |
| Plugin 映射 | `@yunpat/agent-patent-analyzer`（侵权分析模块）（封装为OpenCode Plugin Tool）|
| 使用者 | Invalidation |

##### 多模态类

**PatentImageAnalyzer（专利附图分析代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 分析专利附图（结构图、流程图、电路图、化学结构式），提取技术特征 |
| 输入 | `{ image: FilePath ｜ URL, analysisType: "structure"｜"flow"｜"circuit"｜"chemical"｜"auto", relatedClaims?: string[] }` |
| 输出 | `ImageAnalysis`：图像描述 + 技术特征标注列表 + 与权利要求的特征对照（如提供 claims） |
| 推荐模型 | 多模态模型：glm-4v-plus（优先）/ doubao-vision-pro / 本地 qwen-vl（隐私敏感） |
| Plugin 映射 | 新增（OpenCode 未实现） |
| OpenCode 封装 | 需新建 Plugin Tool / MCP Server |
| 使用者 | Drafting（附图分析）, OA Response（对比文件附图）, Invalidation（目标专利附图） |

**DocumentParser（文档解析代理）**

| 项目 | 说明 |
|------|------|
| 职责 | 解析 PDF/扫描件文档（审查意见通知书、驳回决定等），提取结构化信息 |
| 输入 | `{ document: FilePath, documentType: "office_action"｜"rejection_decision"｜"patent_document"｜"other" }` |
| 输出 | `ParsedDocument`：提取的结构化数据 + OCR 文本（如需）+ 关键区域标注 |
| 推荐模型 | 多模态模型：moonshot-v1 文件模式（长文档）/ glm-4v（单页扫描件） |
| Plugin 映射 | `@yunpat/patent-core`（文档解析扩展）（封装为OpenCode Plugin Tool）|
| 使用者 | OA Response, Reexamination |

##### 嵌入与检索类

**EmbeddingService（嵌入服务）**

| 项目 | 说明 |
|------|------|
| 职责 | 文本向量化，支撑语义检索和相似度计算 |
| 输入 | `{ texts: string[], model?: string }` |
| 输出 | `EmbedResponse`：向量矩阵 + 模型信息 + 维度 |
| 推荐模型 | 嵌入模型：智谱 embedding-3 / 豆包 doubao-embedding-large / 本地 bge-m3（隐私敏感） |
| Plugin 映射 | 新增（基础设施服务） |
| OpenCode 封装 | 需新建 Plugin Tool / MCP Server |
| 使用者 | PatentSearchAgent, HebbianOptimizer, 知识库向量化 |

**RerankService（重排序服务，可选）**

| 项目 | 说明 |
|------|------|
| 职责 | 对检索结果二次精排，提升 Top-K 精度 |
| 输入 | `{ query: string, documents: string[], topN?: number }` |
| 输出 | `RerankResponse`：重排序后的文档列表 + 相关性评分 |
| 推荐模型 | Rerank 模型：本地 bge-reranker-v2-m3（可选） |
| Plugin 映射 | 新增（可选基础设施） |
| OpenCode 封装 | 需新建 Plugin Tool / MCP Server |
| 使用者 | PatentSearchAgent（可选增强） |
| 降级策略 | Rerank 不可用时，直接使用向量检索 + BM25 混合排序结果 |

---

## 第四章：编排层设计

> 编排层是连接交互层（多端界面）和专业层（专利智能体）的中枢。OpenCode 采用隐式编排模型：LLM 根据对话上下文自主决定 Tool 调用序列，复杂多步骤工作流在 Plugin Tool 内部用 TypeScript 代码实现，通过 `ctx.ask()` 触发审批暂停。

### 第十一条：核心概念模型

```
┌─────────────────────────────────────────────────────────────────────┐
│                            User                                      │
│                              │                                       │
│        ┌─────────────┬───────┴───────┬─────────────┬─────────────┐  │
│        │    TUI      │  Desktop App  │   Web UI    │ VSCode Ext  │  │
│        │  (终端)     │  (桌面应用)    │  (Web界面)   │ (插件)      │  │
│        └──────┬──────┴───────┬───────┴──────┬──────┴──────┬──────┘  │
│               │              │              │             │         │
│               └──────────────┼──────────────┘             │         │
│                              │                            │         │
│                    ┌─────────▼──────────┐                 │         │
│                    │  OpenCode Client   │                 │         │
│                    │  (Session Runtime) │  交互层 + 会话运行时 │      │
│                    └─────────┬──────────┘                 │         │
│                              │ UserInput / ToolCallResult            │
│        ┌─────────────────────┼─────────────────────┐                  │
│        │                     │                     │                  │
│   ┌────▼─────┐        ┌─────▼─────┐        ┌─────▼─────┐            │
│   │  Patent  │        │  Patent   │        │  Patent   │            │
│   │  Skill   │        │  Plugin   │        │  MCP      │            │
│   │ (工作流  │        │  (Hooks)  │        │  Servers  │            │
│   │  指令)   │        │           │        │           │            │
│   └────┬─────┘        └─────┬─────┘        └─────┬─────┘            │
│        │                    │                    │                   │
│        │    ┌───────────────┴────────────────────┘                  │
│        │    │                                                        │
│        │    │  ┌──────────────────────────────────────┐             │
│        │    │  │      Patent Plugin Tools             │             │
│        │    │  │  patent_search, patent_analyze,      │             │
│        │    │  │  patent_draft, oa_response, ...      │             │
│        │    │  │                                      │             │
│        │    │  │  · 每个 Tool 内部可编排多步骤         │             │
│        │    │  │  · 步骤间通过 ctx.ask() 暂停          │             │
│        │    │  │  · 质量检查在 Tool 内部自建           │             │
│        │    │  └──────────────────────────────────────┘             │
│        │    │                                                        │
│        │    └────────────────────────────────────────────────────┐   │
│        │                                                       │   │
│        └─────────────────────►  LLM 自主决策 Tool 调用序列 ◄──────┘   │
│                              (由 Skill 指令引导)                      │
│                                                                       │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │              OpenCode Core（通用基础设施）                    │   │
│   │  File | Shell | Search | Git | Code Edit | Subagent | Web    │   │
│   │  Permission System | Model Provider | Snapshot | SyncEvent   │   │
│   └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**关键概念说明**：

1. **Skill（工作流指令）** — 描述专利任务的步骤和调用哪些 Tool，存储为 `SKILL.md` 文件，由 LLM 在对话中自主遵循
2. **Plugin（插件）** — TypeScript 代码，通过 Hooks 机制注册 Patent Tools、注入系统提示词、定义审批策略
3. **MCP Server** — 可选的外部服务，暴露标准化专利 API（检索、数据库查询等），跨客户端兼容
4. **Tool（工具）** — Plugin 暴露的具体功能单元，LLM 根据描述和参数 Schema 自主调用
5. **Session Runtime** — OpenCode 现有会话运行时，管理对话流、Tool 调用、审批流、状态持久化

### 第十二条：核心接口定义

#### 12.1 Plugin 接口

所有专利功能通过 OpenCode Plugin 机制接入。Plugin 是一个异步函数，接收 `PluginInput`，返回 `Hooks`。

```typescript
// packages/plugin/src/index.ts
export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>  // SDK 客户端
  project: Project                                  // 当前项目信息
  directory: string                                 // 当前工作目录
  worktree: string                                  // Git worktree 根
  experimental_workspace: {
    register(type: string, adapter: WorkspaceAdapter): void
  }
  serverUrl: URL
  $: BunShell
}

export type PluginOptions = Record<string, unknown>
```

#### 12.2 Hooks 接口

Plugin 通过返回 Hooks 对象来扩展 OpenCode 行为：

```typescript
export interface Hooks {
  // === 功能暴露 ===
  tool?: { [key: string]: ToolDefinition }          // 注册专利工具

  // === 审批策略 ===
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>

  // === 提示词注入 ===
  "experimental.chat.system.transform"?: (input, output: { system: string[] }) => Promise<void>

  // === 事件监听 ===
  event?: (input: { event: Event }) => Promise<void>
  "tool.execute.before"?: (input, output) => Promise<void>
  "tool.execute.after"?: (input, output) => Promise<void>

  // === 配置与认证 ===
  config?: (input: Config) => Promise<void>
  auth?: AuthHook
  provider?: ProviderHook
}
```

**关键 Hooks 说明**：

| Hook | 用途 | 专利场景 |
|------|------|---------|
| `tool` | 注册专利专用 Tool | `patent_search`, `patent_draft`, `oa_analyze` 等 |
| `permission.ask` | 拦截审批请求，自动放行低风险操作 | 公开数据库检索自动通过，敏感操作仍需审批 |
| `experimental.chat.system.transform` | 注入专利领域系统提示词 | "You are a patent intelligence assistant..." |
| `tool.execute.before/after` | 监听 Tool 执行，记录审计日志 | 记录专利检索、文件生成等操作 |

#### 12.3 Tool 定义接口

专利智能体的核心功能以 Tool 形式暴露：

```typescript
// packages/plugin/src/tool.ts
export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: AskInput): Effect.Effect<void>  // 触发审批暂停
}

type AskInput = {
  permission: string     // 权限名称，如 "patent_search"
  patterns: string[]     // 匹配模式
  always: string[]       // "always allow" 时记忆的模式
  metadata: { [key: string]: any }
}

export type ToolResult = string | { output: string; metadata?: { [key: string]: any } }

export function tool<Args extends z.ZodRawShape>(input: {
  description: string                          // Tool 功能描述（LLM 据此决定是否调用）
  args: Args                                   // Zod Schema 参数定义
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>
}) { return input }
```

**设计要点**：
- `description` 是 LLM 理解 Tool 能力的关键，必须清晰描述功能、输入、输出
- `args` 使用 Zod Schema，OpenCode 自动转换为 LLM 可用的参数格式
- `execute` 内部可用 async/await 实现多步骤编排
- `ctx.ask()` 在任意步骤触发审批暂停，用户回复后继续执行
- `ctx.metadata()` 上报执行元数据（步骤数、耗时、来源等）

#### 12.4 审批接口 (Permission System)

OpenCode 原生权限系统，Plugin 直接复用：

```typescript
// Permission Request（审批请求）
export class Request extends Schema.Class<Request>("PermissionRequest")({
  id: PermissionID,
  sessionID: SessionID,
  permission: Schema.String,       // 如 "patent_search", "patent_draft"
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  tool: Schema.optional(Schema.Struct({
    messageID: MessageID,
    callID: Schema.String,
  })),
}) {}

// Permission Reply（用户回复）
// "once"  → 仅允许本次
// "always" → 将 pattern 加入 approved ruleset（持久化到 SQLite）
// "reject" → 拒绝本次
```

**Plugin 中的使用示例**：

```typescript
async execute(args, ctx) {
  // Step 1: 触发审批
  yield* ctx.ask({
    permission: "patent_draft",
    patterns: [args.patent_type],
    always: ["public_domain"],
    metadata: { section: args.section }
  })
  
  // 用户审批通过后继续...
  const result = await draftPatentSection(args)
  return result
}
```

#### 12.5 模型提供商接口

复用 OpenCode 现有 `ModelProvider`，Plugin 无需自建：

```typescript
// 通过 PluginInput.client 访问
const client = input.client

// 创建新会话（子会话）
const session = await client.session.create({ parentID: currentSessionID, title: "Patent Analysis" })

// 发送消息到子会话
await client.session.send({ sessionID: session.id, message: "Analyze novelty..." })

// 模型调用（Plugin 内部需要 LLM 时）
const response = await client.model.chat({
  model: "deepseek-reasoner",
  messages: [{ role: "user", content: "分析创造性..." }]
})
```

**模型选择**：
- 轻量快速任务（意图识别、格式检查）→ OpenCode 默认模型
- 深度推理任务（创造性分析、策略制定）→ `deepseek-reasoner` 或等效模型
- 多模态任务（附图分析、PDF解析）→ 配置中的多模态模型
- 嵌入任务（语义检索）→ 配置中的嵌入模型

#### 12.6 阶段输出与流式反馈

OpenCode 的 Tool 执行结果通过 Streaming 返回用户。对于多步骤专利工作流，通过以下方式提供阶段反馈：

```typescript
// 方式1：返回 Markdown 内容（自动流式输出）
return `
## 步骤 1/5：发明理解 ✅

**技术问题**：...
**技术方案**：...
**技术效果**：...

---

*等待用户确认后进入步骤 2...*
`

// 方式2：使用 metadata 上报结构化阶段信息
ctx.metadata({
  title: "发明理解完成",
  metadata: {
    stage: "step_1_understand",
    totalSteps: 5,
    confidence: 0.92,
    awaitingApproval: true
  }
})
```

**阶段类型映射**（对应原 StageType 概念）：

| 原 StageType | OpenCode 实现方式 |
|-------------|------------------|
| analysis | Tool 返回 Markdown 分析结果 |
| suggestion | Tool 返回选项列表，用户通过对话选择 |
| draft | Tool 返回草案文本，用户编辑后反馈 |
| question | Tool 返回问题，等待用户回复后继续 |
| progress | Tool 返回进度信息，使用 metadata 上报 |
| completed | Tool 返回最终成果，标记完成 |

### 第十三条：路由与触发机制

OpenCode 无显式 Router 模块，专利工作流通过以下三种机制触发：

#### 13.1 显式命令触发

用户通过命令直接调用专利功能：

| 命令 | 功能 |
|------|------|
| `/patent research <topic>` | 启动规则研究 |
| `/patent draft <file>` | 启动专利撰写 |
| `/patent oa <file>` | 启动审查意见答辩 |
| `/patent reexam <file>` | 启动复审 |
| `/patent invalid <patent>` | 启动无效宣告 |

#### 13.2 Skill 引导的隐式触发

通过 `SKILL.md` 文件向 LLM 注入专利领域上下文，LLM 根据用户输入自主调用相关 Tool：

```markdown
### Patent Workflow Skill

当用户涉及以下意图时，使用对应的 Patent Plugin Tools：

- 法规/案例研究 → `patent_research`
- 技术交底书/专利申请 → `patent_draft`
- 审查意见/答复 → `oa_analyze` + `oa_response`
- 驳回决定 → `reexam_analyze`
- 专利无效 → `invalidation_analyze`

每个 Tool 调用后，等待用户确认再继续下一步。
```

#### 13.3 文件类型自动识别

用户上传特定文件时，OpenCode 自动提示相关专利功能：

| 文件类型 | 触发功能 |
|---------|---------|
| 技术交底书（.doc/.pdf） | 建议启动 `patent_draft` |
| 审查意见通知书（.pdf） | 建议启动 `oa_analyze` |
| 驳回决定（.pdf） | 建议启动 `reexam_analyze` |
| 权利要求书（.doc） | 建议启动 `patent_analyze` |

### 第十四条：会话与案件映射

OpenCode 无原生 Case（案件）概念，采用以下映射方案：

```
Project（项目）— OpenCode 现有概念，复用为"案件容器"
  ├── 案件元数据存储在 Project 扩展字段或 Plugin 配置中
  ├── 一个 Project 对应一个专利案件
  └── 通过 Git worktree 或目录隔离不同案件

Session（会话）— OpenCode 现有概念，复用为"任务线程"
  ├── 可包含多个 Tool 调用序列
  ├── 一个 Session 对应一个具体任务（如"撰写权利要求"）
  ├── parent_id 支持任务分叉（如从"撰写"分叉出"修改"）
  └── 支持归档，保留完整任务历史

Message + Part — 对话消息
  ├── User 消息：用户输入、文件上传、审批决策
  ├── Assistant 消息：LLM 回复、Tool 调用请求
  ├── Tool Part：Tool 执行结果、阶段输出
  └── 完整记录人机协作全过程
```

**案件元数据存储方案**：

```typescript
// 方案1：Plugin 内部存储（推荐）
// Plugin 在加载时读取配置文件中的案件信息
const caseInfo = await input.client.config.get("patent.case")

// 方案2：Project 扩展（需 OpenCode 支持）
// ProjectTable 新增 metadata JSON 字段存储案件信息

// 方案3：独立数据库
// Plugin 自建 SQLite 表管理案件数据
```

**推荐：方案1（Plugin 配置）+ 方案3（独立表）组合**
- 简单元数据（案件名称、类型、状态）→ Plugin 配置
- 复杂数据（文档列表、任务历史、期限）→ Plugin 自建表

### 第十五条：通用模式兼容

当用户的输入不触发任何专利功能时，系统完全退化为现有 OpenCode 的行为：

1. **通用对话** — 所有编码、文件操作、搜索等现有功能不变
2. **工具体系** — 现有全部工具（shell, file, git, web, subagent 等）不变
3. **模型调用** — 现有 streaming Chat Completions 流程不变
4. **审批体系** — 现有 plan/agent/yolo 模式和工具审批流程不变
5. **多平台** — TUI、Desktop、Web、VSCode 的通用能力全部保留

专利 Plugin 与通用编码能力在同一平台共存，可在同一对话中无缝切换。用户可以在撰写专利权利要求的间隙让 AI 修一段代码，然后继续专利工作。

---

## 第五章：技术约束

### 第十六条：融合架构与分层选型

YunPat OpenCode 采用 **YunPat 现有代码封装为 OpenCode Plugin** 的方式，在 OpenCode 架构之上叠加专利智能体能力。YunPat（`/Users/xujian/projects/YunPat`）是已存在的成熟项目（49 个包、29 个智能体、18.4 万行代码、4,385 文件知识库），封装时优先复用现有模块，而非重写业务逻辑。

遵循以下规则：

1. **统一入口** — 复用 OpenCode 的 `opencode` CLI 和 Desktop/Web 应用入口，通过配置和命令触发专利功能
2. **统一会话** — 编码任务和专利任务共享 OpenCode 的 Session 运行时和上下文
3. **统一工具注册** — 通用工具和专利工具在同一个 Tool Registry 中管理（Plugin `Hooks.tool`）
4. **保留现有能力** — 所有 OpenCode 现有功能必须 100% 保留，不得降级
5. **YunPat 代码优先复用** — 专利业务逻辑优先封装 YunPat 现有 Agent/Tool/服务，非必要不重写
6. **Plugin 为主，MCP 为辅** — 深度集成通过 Plugin 实现，跨客户端兼容通过 MCP Server 实现

**分层选型原则**：

```
┌─────────────────────────────────────────────────────────────────┐
│  交互层    TUI / Desktop App / Web UI / VSCode Extension       │
│            （OpenCode 原生，100% 保留）                          │
├─────────────────────────────────────────────────────────────────┤
│  会话运行时  OpenCode Session Runtime（TS/Effect）              │
│             （对话流、Tool 调用、审批流、Streaming）              │
├─────────────────────────────────────────────────────────────────┤
│  Plugin 层   opencode-patent-plugin（TypeScript）               │
│             ├─ Hooks.tool: 封装 YunPat 29 个 Agent 为 Tools    │
│             ├─ Hooks.permission.ask: 专利审批策略               │
│             ├─ Hooks.experimental.chat.system.transform         │
│             └─ 内部服务: 复用 YunPat 知识库/向量检索/模板       │
├─────────────────────────────────────────────────────────────────┤
│  MCP 层    @yunpat/mcp-server（已有，TS/Node）                 │
│            （标准化专利 API，跨客户端兼容）                       │
├─────────────────────────────────────────────────────────────────┤
│  服务层    YunPat 后端服务（独立进程 / Docker）                 │
│            ├─ @yunpat/patent-database（7500万 CN 专利）         │
│            ├─ @yunpat/patent-core（Rust CLI bridge）            │
│            ├─ @yunpat/rust-tools（向量/相似度服务）              │
│            ├─ @yunpat/python-tools（ML 模型服务）               │
│            └─ @yunpat/unified-knowledge-graph（知识图谱）       │
├─────────────────────────────────────────────────────────────────┤
│  数据层    OpenCode SQLite（Session/Project）                   │
│            + Plugin 自建表（案件元数据、任务历史）               │
│            + YunPat PostgreSQL（专利数据库、向量索引）           │
│            + knowledge-base/（4,385 文件本地知识库）             │
└─────────────────────────────────────────────────────────────────┘
```

**各层说明**：

- **OpenCode Core** — 完全复用，不修改。Session 管理、Permission 系统、Model Provider、Snapshot、SyncEvent、Config 系统等
- **Patent Plugin** — 核心封装层。将 YunPat 的 Agent 封装为 OpenCode Plugin Tools，复用 YunPat 的 `ProfessionalAgent.run()` 生命周期。Plugin 通过运行时动态加载（`YUNPAT_PATH` 环境变量 + `import()` 动态导入）引用 YunPat 现有包，避免 Bun/pnpm 工具链冲突。当 YunPat 不可用时，自动降级为 DB/KB 查询或 LLM 纯推理模式
- **MCP Server** — 复用 YunPat 已有的 `@yunpat/mcp-server`，暴露 `patent_search`、`claims_generator`、`quality_checker` 等标准化 API
- **YunPat Backend Services** — 独立运行的后端服务（Docker 或本地进程），包括专利数据库（PostgreSQL + 7500万 CN 专利）、Rust 性能服务（向量/相似度）、Python ML 服务、知识图谱等。Plugin 通过 gRPC / REST / CLI 调用这些服务
- **Data Layer** — 三层存储：OpenCode SQLite（会话/项目）、Plugin 自建表（案件元数据）、YunPat PostgreSQL（专利数据/向量索引/结构化知识）

### 第十七条：Plugin 开发规范

#### 17.1 Plugin 目录结构

```
opencode-patent-plugin/
├── package.json              # npm 包定义，声明 opencode 兼容版本
│   └── dependencies:
│       ├── @opencode-ai/plugin     # OpenCode Plugin SDK
│       ├── @opencode-ai/sdk        # OpenCode SDK
│       ├── pg                      # PostgreSQL 客户端（专利数据库）
│       └── ...（其他通用依赖）
│   └── yunpat: { note: "YunPat 模块通过 YUNPAT_PATH 运行时动态加载，非构建时依赖" }
├── src/
│   ├── index.ts              # Plugin 入口，注册所有 Tools 和 Hooks
│   ├── tools/                # Patent Tools 定义（封装 YunPat Agent）
│   │   ├── research.ts       # patent_research → 动态加载 ResearcherAgent
│   │   ├── draft.ts          # patent_draft → 动态加载撰写 Agent 链
│   │   ├── oa.ts             # oa_response → 动态加载 PatentResponderAgent
│   │   ├── reexam.ts         # reexam_response → 动态加载分析/撰写 Agent
│   │   ├── invalidation.ts   # invalidation_response → 动态加载分析/撰写 Agent
│   │   ├── search.ts         # patent_search → 动态加载 PatentSearchAgent
│   │   ├── analyze.ts        # patent_analyze → 动态加载 ComparisonAnalyzerAgent
│   │   ├── check.ts          # patent_check → 动态加载 QualityCheckerAgent
│   │   ├── trademark-*.ts    # 商标全流程（6 个工具）
│   │   ├── document-reader.ts # 文档解析（DOCX/PDF）
│   │   ├── file-writer.ts    # 文件输出
│   │   ├── task-memory.ts    # 跨会话记忆
│   │   └── case-manager.ts   # 案件管理
│   ├── services/             # 内部服务层
│   │   ├── knowledge-base.ts # Obsidian 知识库查询服务
│   │   ├── vector-store.ts   # PostgreSQL 向量检索服务
│   │   ├── template-service.ts # 模板访问服务
│   │   ├── quality-service.ts  # 7 维度质量检查服务
│   │   └── workflow-orchestrator.ts # 多步骤工作流编排器
│   ├── hooks/                # Plugin Hooks 实现
│   │   ├── permission.ts     # 审批策略（专利操作分级审批）
│   │   ├── system-prompt.ts  # 系统提示词注入（专利领域上下文 + 工作流指引）
│   │   └── audit-log.ts      # 审计日志 + 案件任务追踪
│   ├── workflows/            # 工作流步骤定义
│   │   ├── draft-flow.ts     # 专利撰写 5 步骤
│   │   ├── oa-flow.ts        # OA 答辩 5 步骤
│   │   ├── reexam-flow.ts    # 复审 4 步骤
│   │   ├── invalidation-flow.ts # 无效宣告 4 步骤
│   │   └── research-flow.ts  # 规则研究 3 步骤
│   ├── utils/                # 工具函数
│   │   ├── yunpat-loader.ts  # 运行时动态加载器（YUNPAT_PATH + import()）
│   │   ├── agent-runner.ts   # Agent 执行器（安全运行 + 超时 + 降级）
│   │   ├── agent-factory.ts  # 共享 Agent 上下文工厂
│   │   ├── case-store.ts     # 案件数据存储（SQLite）
│   │   ├── case-state-machine.ts # 案件生命周期状态机
│   │   ├── workflow-store.ts # 工作流模板存储（SQLite）
│   │   └── db.ts             # PostgreSQL 数据库访问
│   ├── shared/               # 共享定义
│   │   ├── constants.ts      # 常量（质量阈值、超时等）
│   │   └── types.ts          # 共享类型
│   ├── adapters/             # 外部适配器
│   │   └── llm.ts            # LLM 适配器（OpenAI-compatible API）
│   ├── templates/            # 专利文件模板
│   └── tui/                  # TUI 面板组件
└── tests/                    # 测试
```

> **动态加载机制**（`yunpat-loader.ts`）：
> - 通过 `YUNPAT_PATH` 环境变量定位 YunPat 根目录
> - `loadYunPatModule(moduleName)` 使用动态 `import()` 加载模块，路径解析策略：package.json main → dist/index.js → src/index.ts
> - 模块缓存（`moduleCache`）防止重复加载；并发安全（`loadingPromises`）防止并发加载
> - 加载失败时返回 `null`，工具自动降级为 DB/KB 查询或 LLM 纯推理
>
> **AGENT_CONFIGS 注册表**（`agent-runner.ts`）：集中定义所有 YunPat Agent 的模块路径和类名映射，工具通过 `runAgentSafely(config)` 统一调用。
>
> **三层降级链**：Agent（动态加载 YunPat）→ DB/KB（PostgreSQL + Obsidian 知识库）→ LLM（纯推理）

#### 17.2 Tool 开发规范

每个 Patent Tool 必须遵循：

1. **描述清晰** — `description` 必须让 LLM 明确知道何时调用、输入什么、输出什么
2. **参数精确** — `args` 使用 Zod Schema，必填/选填明确，提供 `enum` 限制选项值
3. **审批合规** — 涉及敏感操作的 Tool 必须在 `execute` 开头调用 `ctx.ask()`
4. **错误友好** — 错误信息返回给用户时应包含修复建议
5. **元数据上报** — 通过 `ctx.metadata()` 上报执行阶段、耗时、来源等信息

**示例**（封装 YunPat 现有 Agent）：

```typescript
import { ResearcherAgent } from "@yunpat/agent-researcher"
import { PatentKnowledge } from "@yunpat/patent-knowledge"
import { UnifiedKnowledgeGraph } from "@yunpat/unified-knowledge-graph"

export const patent_research = tool({
  description: `
    研究知识产权法规与实务规则。当用户询问专利相关法规、审查指南、
    案例或实务操作时调用此工具。
    
    输入：研究主题、范围（法规/案例/实务/全部）、深度（概述/详细/深度）
    输出：结构化研究报告（Markdown），包含法规条文、案例摘要、操作要点
  `,
  args: {
    topic: z.string().describe("研究主题，如'新用途专利创造性判定'"),
    scope: z.enum(["法规", "案例", "实务", "全部"]).optional(),
    depth: z.enum(["概述", "详细", "深度"]).optional(),
  },
  async execute(args, ctx) {
    // 步骤 1: 初始化 YunPat Agent（复用现有代码）
    const agent = new ResearcherAgent({
      llm: await getLLMFromOpenCode(ctx),  // 从 OpenCode 获取当前 LLM 配置
      knowledgeBase: new PatentKnowledge(),
      knowledgeGraph: new UnifiedKnowledgeGraph(),
    })
    
    // 步骤 2: 调用 YunPat Agent 执行研究（复用 plan→act→reflect 生命周期）
    const result = await agent.run({
      topic: args.topic,
      scope: args.scope,
      depth: args.depth,
    })
    
    // 步骤 3: 上报元数据
    ctx.metadata({ 
      title: `规则研究: ${args.topic}`, 
      metadata: { 
        scope: args.scope,
        sources: result.sources.length,
        confidence: result.confidence 
      } 
    })
    
    return formatResearchReport(result)
  }
})
```

**封装要点**：
1. **Agent 复用** — 直接 `new YunPatAgent()` 实例化 YunPat 现有 Agent，传入 OpenCode 的 LLM 配置
2. **生命周期映射** — YunPat 的 `plan→act→reflect→checkpoint` 循环在 Tool `execute()` 内完整运行
3. **HITL 转换** — YunPat 的 checkpoint 暂停点转换为 `ctx.ask()` 触发 OpenCode 审批流
4. **EventBus 隔离** — YunPat Agent 间的 EventBus 通信在 Plugin 内部完成，不暴露到 OpenCode Session
5. **结果转换** — YunPat 的 `AgentResult` 转换为 OpenCode 的 `ToolResult`（Markdown 字符串）

#### 17.3 Skill 编写规范

Skill 文件指导 LLM 如何使用 Patent Tools 完成复杂工作流：

```markdown
### Patent Drafting Skill

## 触发条件
用户要求撰写专利申请文件，或上传技术交底书时激活此 Skill。

## 工作流（5 步骤）

### 步骤 1：发明理解
调用 `patent_draft` tool，action="understand"
- 输入：技术交底书内容
- 输出：发明三元组（技术问题-技术方案-技术效果）
- 暂停：展示摘要，等待用户确认

### 步骤 2：现有技术检索
调用 `patent_search` tool
- 输入：发明关键词、IPC 分类
- 输出：对比文件列表 + 相关性分析
- 暂停：展示检索结果，用户可补充/排除对比文件

### 步骤 3：说明书撰写
调用 `patent_draft` tool，action="specification"
- 输入：发明理解 + 检索结果
- 输出：逐章节说明书草案
- 暂停：逐章节展示，用户审阅修改

### 步骤 4：权利要求撰写
调用 `patent_draft` tool，action="claims"
- 输入：发明点 + 说明书
- 输出：权利要求书草案
- 暂停：展示保护范围策略，用户确认后逐条审阅

### 步骤 5：摘要与整合
调用 `patent_draft` tool，action="abstract"
- 输入：全文
- 输出：摘要 + 完整申请文件
- 结束：展示最终成果

## 质量标准
每步骤完成后自动评估，得分 < 7.5 则重新生成（最多 3 次）。
```

#### 17.4 MCP Server 规范

MCP Server 提供跨客户端兼容的标准化专利 API：

```typescript
// MCP Server 工具列表
{
  tools: [
    { name: "patent_search", description: "检索专利文献", inputSchema: {...} },
    { name: "patent_analyze", description: "分析专利文本", inputSchema: {...} },
    { name: "patent_classify", description: "IPC/CPC 分类", inputSchema: {...} },
  ]
}
```

**MCP vs Plugin 分工**：

| 能力 | MCP Server | Plugin |
|------|-----------|--------|
| 跨客户端兼容 | ✅ 任何 MCP 客户端可用 | ❌ 仅 OpenCode |
| 修改 OpenCode 行为 | ❌ 不能 | ✅ Hooks 深度集成 |
| 审批流控制 | ❌ OpenCode 统一包装 | ✅ 自定义策略 |
| 系统提示词注入 | ❌ 不能 | ✅ 可注入 |
| 复杂工作流编排 | ❌ 简单 Tool 调用 | ✅ TS 代码完整编排 |
| 部署方式 | 独立进程 | npm 包或本地文件 |

**推荐**：核心 API 用 MCP Server 暴露，深度集成和复杂编排用 Plugin 实现。

### 第十八条：模型与基础设施

复用 OpenCode 现有 Model Provider 体系，Plugin 通过 `input.client` 调用模型服务。

**多模型供应商**（复用 OpenCode 配置）：

| 提供商 | 用途 | Plugin 调用方式 |
|--------|------|----------------|
| DeepSeek | 文本推理/生成（默认） | `client.model.chat({ model: "deepseek-chat" })` |
| 智谱（GLM） | 文本/多模态/嵌入 | `client.model.chat({ model: "glm-4v" })` |
| 月之暗面（Kimi） | 长文本/文档理解 | `client.model.chat({ model: "moonshot-v1" })` |
| 豆包（字节跳动） | 文本/多模态/嵌入 | `client.model.chat({ model: "doubao-pro" })` |
| 本地模型 | 隐私敏感场景 | `client.model.chat({ model: "local-llm" })` |

**模型选型指南**：

| 任务类型 | 推荐模型 | 温度 |
|---------|---------|------|
| 意图识别、格式检查 | 轻量快速模型（默认模型） | 0.2 |
| 深度推理（创造性分析、策略制定） | deepseek-reasoner / 等效模型 | 0.3 |
| 多模态（附图分析、PDF 解析） | glm-4v-plus / doubao-vision-pro | 0.3 |
| 嵌入（语义检索） | embedding-3 / doubao-embedding-large | — |
| Rerank（检索精排） | bge-reranker-v2-m3（本地） | — |

**本地模型优先级**：oMLX > Ollama > vLLM（与 OpenCode 原生一致）

### 第十九条：数据与隐私

1. **本地优先** — 所有案件数据默认存储在本地 SQLite，不强制上传云端
2. **数据隔离** — 不同案件通过不同 Project/目录隔离，Plugin 配置区分
3. **敏感信息保护** — 涉及未公开发明内容的操作通过 `ctx.ask()` 强制审批
4. **可审计** — 所有 AI 参与的操作通过 `tool.execute.after` Hook 记录完整日志

### 第二十条：质量保证

1. **专业审校** — AI 生成的法律文件必须经过专业审校流程（Plugin Tool 输出标记 "draft" 状态）
2. **模板驱动** — 专利文件生成基于经过验证的模板，不凭空生成
3. **一致性检查** — 权利要求与说明书的一致性在 Plugin Tool 内部自动检查
4. **法规更新** — 知识库更新机制：Plugin 定期检查法规变更，更新本地知识库
5. **质量迭代** — 质量检查在 Plugin Tool 内部实现，得分 < 7.5 自动重新生成（最多 3 次），超出转人工

---

## 第六章：修订与治理

### 第十九条

本宪法的修订需要明确记录修订原因和影响范围。每次修订产生新版本，旧版本归档保留。

### 第二十条

当技术实现细节与宪法原则冲突时：
1. 首先评估是否可以通过调整实现方式解决
2. 如果技术限制确实无法满足宪法要求，提出宪法修正案讨论
3. 在修正案通过前，技术实现应尽可能接近宪法要求

---

## 第七章：数据模型映射

> OpenCode 无原生 Case（案件）概念，采用 Project/Session 语义映射方案。

### 第二十一条：Project ↔ Case 映射

| Case 概念 | OpenCode 概念 | 映射方式 |
|----------|--------------|---------|
| 案件 | Project | 一个 Project 对应一个专利案件 |
| 案件编号 | Project.worktree 或 Plugin 配置 | 通过目录命名或配置存储 |
| 发明名称 | Project.name | 直接映射 |
| 案件类型 | Plugin 配置 `patent.case.type` | Plugin 元数据 |
| 案件状态 | Plugin 配置 `patent.case.status` | Plugin 元数据 |
| 申请人 | Plugin 配置 `patent.case.applicant` | Plugin 元数据 |
| 发明人 | Plugin 配置 `patent.case.inventor` | Plugin 元数据 |
| 代理师 | Plugin 配置 `patent.case.agent` | Plugin 元数据 |

**案件创建流程**：

```
用户: /patent case create "新型电池制备方法"
  → Plugin: 创建新 Project（如未存在）
  → Plugin: 写入案件元数据到 Plugin 配置
  → Plugin: 初始化案件目录结构
  → User: 案件已创建，可开始撰写/检索/分析
```

### 第二十二条：Session ↔ CaseTask 映射

| CaseTask 概念 | OpenCode 概念 | 映射方式 |
|-------------|--------------|---------|
| 任务 | Session | 一个 Session 对应一个具体任务 |
| 任务类型 | Session.title / Plugin 配置 | 通过会话标题或元数据区分 |
| 父任务 | Session.parent_id | 利用 Session 父子关系 |
| 任务历史 | Session 消息记录 | 完整 Message + Part 历史 |
| 任务状态 | Session 活跃状态 + 归档状态 | active / archived |

**典型任务映射**：

| 专利工作 | OpenCode Session 标题示例 |
|---------|-------------------------|
| 发明理解 | "发明理解 - 新型电池" |
| 现有技术检索 | "检索 - 新型电池相关专利" |
| 说明书撰写 | "说明书 - 新型电池" |
| 权利要求撰写 | "权利要求 - 新型电池" |
| 审查意见答辩 | "OA答辩 - 申请号CN2026..." |
| 复审请求 | "复审 - 驳回决定分析" |
| 无效宣告 | "无效 - 目标专利分析" |

### 第二十三条：文档管理

专利案件相关文档存储在 Project 目录下，利用 OpenCode 的 Snapshot 系统进行版本管理：

```
project-directory/
├── .opencode/
│   └── opencode.jsonc          # 项目配置（含 Plugin 配置）
├── patent-documents/           # 专利文档目录
│   ├── disclosure/             # 技术交底书
│   ├── application/            # 申请文件
│   ├── office-actions/         # 审查意见通知书
│   ├── responses/              # 答辩文件
│   └── prior-art/              # 对比文件
└── src/                        # 原有代码文件（如为代码项目）
```

**文档版本管理**：
- OpenCode Snapshot 系统自动追踪 `patent-documents/` 下的变更
- 每次提交审查、修改权利要求等操作前自动创建快照
- 支持 diff、restore、revert

### 第二十四条：Plugin 数据存储

Plugin 自建数据表管理案件复杂数据：

```sql
-- Plugin 自建表（示例）
CREATE TABLE patent_cases (
  id TEXT PRIMARY KEY,           -- 对应 Project.id
  application_no TEXT,           -- 申请号
  patent_type TEXT,              -- 发明/实用新型/外观设计
  status TEXT,                   -- active/closed/archived
  metadata TEXT,                 -- JSON 扩展字段
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE patent_documents (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES patent_cases(id),
  doc_type TEXT,                 -- disclosure/application/office_action/...
  file_path TEXT,
  version INTEGER,               -- 版本号
  created_at INTEGER
);

CREATE TABLE patent_tasks (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES patent_cases(id),
  session_id TEXT,               -- 关联 OpenCode Session.id
  task_type TEXT,                -- research/draft/oa/reexam/invalid
  status TEXT,
  output_artifacts TEXT,         -- JSON 文件路径数组
  created_at INTEGER,
  completed_at INTEGER
);
```

---

## 第八章：实施路径

### 第二十五条：Phase 0 — 宪法定稿与架构验证（2-3 周）

1. 定稿本宪法，团队评审确认
2. 搭建 `opencode-patent-plugin` 基础框架（TypeScript/Bun）
3. 实现 Research Agent 的 Plugin Tool 原型（`patent_research`）
4. 验证审批流（`ctx.ask()`）、多步骤编排、Skill 引导
5. 验证 TUI/Desktop/Web 多端表现一致

### 第二十六条：Phase 1 — MVP 场景实现（6-8 周）

1. 实现全部 5 个场景智能体的 Plugin Tool 版本
2. 搭建 Patent MCP Server（检索、数据库查询标准化 API）
3. 编写 Patent Workflow Skills（撰写/答辩/复审/无效）
4. 集成知识库（knowledge-base 向量化索引）
5. 案件数据模型（Project 扩展 + Plugin 自建表）
6. 模板系统（权利要求/说明书/答辩文件模板）

### 第二十七条：Phase 2-4 — 全面扩展

1. 全流程管理 — 从发明披露到授权维护的生命周期
2. 多 IP 类型 — 商标、版权、商业秘密等领域扩展
3. 协作网络 — 多智能体协同处理跨领域复杂案件
4. 质量系统 — Plugin 层自建 7 维度质量评估 + 自动迭代
5. 生态建设 — 发布 Plugin 到 npm，文档、示例、社区

---

*宪法版本: v0.8-draft*
*创建日期: 2026-05-07*
*修订日期: 2026-05-08*
*状态: 草案，已适配实际动态加载架构，偏差消除中*
*变更记录:*
- *v0.8 — 架构偏差消除：第十六条融合架构更新为运行时动态加载模式（YUNPAT_PATH + import()），替代原规划的构建时依赖；第十七条 Plugin 目录结构更新为实际结构（services/hooks/workflows/utils/shared）；新增动态加载规范说明（三层降级链、AGENT_CONFIGS 注册表、模块路径约定）*
- *v0.7 — 全面适配 OpenCode 架构：技术栈从 Rust 改为 TypeScript/Bun/Effect；编排层从显式 Orchestrator 改为 OpenCode Session Runtime + Plugin Hooks；Agent 注册从动态 AgentRegistry 改为 Plugin Tool + Skill 指令；交互层从单一 TUI 扩展为 TUI/Desktop/Web/VSCode 多平台；Case 概念改为 Project/Session 语义映射；新增第七章数据模型映射；第五章重写为 Plugin 开发规范 + 技术约束；第四章完全重写为 OpenCode Plugin 架构接口；第三章第十条全部 22 个共享智能体映射更新为准确的 YunPat 包名（@yunpat/agent-researcher, @yunpat/agent-patent-writer 等）；融合架构明确为"YunPat 现有代码封装为 OpenCode Plugin"，复用 49 个包、29 个智能体、4,385 文件知识库*
- *v0.6 — 多模型供应商支持（DeepSeek/智谱GLM/月之暗面Kimi/豆包/本地模型 5 供应商）；强制多模态（专利附图分析/OA PDF 解析/技术图纸理解）；强制嵌入模型（语义检索/向量召回/知识库索引）；可选 Rerank；本地模型优先级 oMLX > Ollama > vLLM；共享智能体扩展至 22 个（+PatentImageAnalyzer/DocumentParser/EmbeddingService/RerankService）；AgentContext 统一 ModelProvider 接口；StageOutput 新增 MultimodalContent；ModelProviderConfig/ProviderConfig/ModelConfig 接口定义；懒加载规则*
- *v0.5 — 重写全部 5 个场景智能体为编排流程（5步骤/子智能体调用/分析框架/策略矩阵/文档模板）；共享智能体扩展至 18 个（含完整输入/输出规范）；编排层新增 OrchestrationFlow 模型 + MCP Bridge 接口；第十六条新增分层选型原则；Case 数据结构定义；移除补正模式*
- *v0.4 — 新增第四章编排层设计（6 个核心接口 + 路由规则 + 会话案件分离 + 通用兼容）；补正合并到 OA Response Agent；条款重编号至 20 条*
- *v0.3 — 扩展智能体规范为完整定义（5 个独立智能体 + 7 个共享智能体）；YunPat 资产映射*
- *v0.2 — 确认项目名称 YunPat TUI、人主导+AI辅助统一模式、全新整合策略*
