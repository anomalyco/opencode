# 专利智能体内置化设计

> 日期：2026-05-26
> 状态：已批准
> 范围：第一批（检索研究 + 撰写全链路）

---

## 1. 背景与目标

### 现状

当前专利能力通过 `opencode-patent-plugin`（外部 plugin）和 `YunPat`（外部依赖，通过 `YUNPAT_PATH` 动态加载）实现。存在以下问题：

- 25+ Agent 通过 `yunpat-loader` 动态加载，依赖外部模块可用性
- 自建 LLM 适配器（`OpenCodeLLMAdapter`），与 OpenCode 的 Provider/Auth 管线重复
- 工作流编排、质量检查等核心能力被隔离在 plugin 中
- 无法复用 OpenCode 原生的 Effect/Permission/Session 体系

### 目标

将专利智能体逐步集成到 OpenCode 原生 Agent 系统，完全解耦 YunPat 外部依赖：

1. **第一批**：检索研究 + 撰写全链路（patent-draft、patent-oa 两个工作流 Agent + 5 个专项 Tool）
2. **后续批次**：创造性判断、复审、无效等
3. **最终**：移除 `opencode-patent-plugin` 包

### 核心决策

- **方案**：Agent Service 扩展 + 内置 Agent 定义（方案 1）
- **实现形态**：纯核心内置（非 plugin）
- **架构**：两层（工作流 Agent + 专项 Tool）
- **数据存储**：文件 + SQLite 默认技术栈，其他后端可选
- **专利检索**：默认不可用，Google Patents API / 本地数据库作为可选后端
- **YunPat**：完全解耦

---

## 2. 整体架构

### 两层架构

```
Layer 1: 工作流智能体（注册为 OpenCode subagent）
├── patent-draft        ← 撰写工作流（5步）
├── patent-oa           ← OA答复工作流（5步）
├── patent-reexam       ← 复审工作流（后续批次）
└── patent-invalidation ← 无效工作流（后续批次）

Layer 2: 专项能力工具（注册为 OpenCode Tool）
├── patent_convert      ← 文档格式转换 + 图纸多模态理解
├── patent_research     ← 法规研究（LLM 综合，scope 含 ipc）
├── patent_search       ← 专利检索（可选后端）
├── patent_analyze      ← 技术分析（对比/新颖性/创造性）
└── patent_check        ← 质量检查（7维度 + 自动修复）

Effect Services（内部直接调用，不暴露为 Tool）
├── PatentDocument      ← 文档格式转换（docx/pdf/图片/音频 → Markdown）
├── PatentDrawing       ← 技术图纸多模态理解（vision model）
├── PatentKnowledge     ← 语义检索 + 文件KB
├── PatentKG            ← 知识图谱
├── PatentLaw           ← 法律法规
├── PatentIPC           ← IPC分类
├── PatentSearch        ← 专利检索后端
├── PatentWorkflow      ← 工作流状态机
├── PatentQuality       ← 质量检查引擎
└── PatentTemplate      ← 文档模板
```

### 调用关系

```
用户消息 → Professional Router（保留）
         → 命中专利领域 → 主 Agent 调用 task(patent-draft, ...) / task(patent-oa, ...)
                                → 工作流 Agent 执行
                                  → 使用 OpenCode Provider LLM 管线
                                  → 调用 Layer 2 Tools（patent_research/search/analyze/check）
                                  → Tools 内部调用 Effect Services
                                  → 返回结果给主 Agent
```

---

## 3. Effect Services 层

### 3.1 存储分层

| 层级 | 默认技术栈 | 数据 | 可选后端 |
|------|-----------|------|---------|
| 知识图谱 | SQLite (`patent_kg.db`) | 40309 节点、408185 边 | Neo4j |
| 语义检索 | SQLite (向量扩展) | 21179 chunks, bge-m3 1024维 | Qdrant |
| 法律数据库 | SQLite (`laws.db`) | 法律法规结构化数据 | PostgreSQL |
| IPC 分类 | SQLite (FTS5) | 75929 条分类号 + 227 个统计节点 | API |
| 文件知识库 | Markdown 文件夹 | 130 知识卡片 + 审查指南 + 复审无效等 | Obsidian |
| 工作流状态 | Drizzle (bun:sqlite) | 工作流步骤状态 | PostgreSQL |
| 专利检索 | **无（默认不依赖）** | — | 本地数据库 / Google Patents API |

数据资产不提交远程仓库（`.gitignore` 排除 `*.db` 和 `data/`），部署时通过符号链接或初始化脚本连接。

### 3.2 PatentKG Service

知识图谱查询。直接操作 `patent_kg.db`。

```ts
export interface Interface {
  readonly queryNode: (name: string) => Effect.Effect<KGNode | null>
  readonly queryRelated: (nodeId: string, relation?: string) => Effect.Effect<KGEdge[]>
  readonly queryByLawRef: (ref: string) => Effect.Effect<KGNode[]>
  readonly fullTextSearch: (query: string) => Effect.Effect<KGNode[]>
}
```

数据：40309 节点（法条 Case、GuidelineRule、Concept、IPC 等）、408185 边、FTS5 全文索引。

### 3.3 PatentKnowledge Service

语义检索 + 文件知识库查询。

```ts
export interface Interface {
  readonly searchSemantic: (query: string, opts: { limit: number; threshold: number })
    => Effect.Effect<SearchResult[]>
  readonly searchCards: (keyword: string) => Effect.Effect<CardResult[]>
  readonly searchGuidelines: (topic: string) => Effect.Effect<string>
  readonly searchInvalidation: (topic: string) => Effect.Effect<string>
}
```

数据：`semantic-index.db`（21179 chunks, bge-m3 1024维嵌入）+ `cards/`（130 知识卡片 .md）+ `审查指南/` + `复审无效/`。

### 3.4 PatentLaw Service

法律法规数据库查询。

```ts
export interface Interface {
  readonly searchLaw: (keyword: string) => Effect.Effect<LawResult[]>
  readonly getByCategory: (category: string) => Effect.Effect<LawResult[]>
  readonly getLawContent: (id: string) => Effect.Effect<string>
}
```

数据：`laws.db`（法律、行政法规、司法解释、部门规章等，按分类组织）。

### 3.5 PatentIPC Service

IPC 分类号查表 + 统计数据。不单独暴露为 Tool，被 `patent_research` 和 `patent_search` 内部调用。

```ts
export interface Interface {
  readonly searchByDescription: (keyword: string) => Effect.Effect<IPCEntry[]>
  readonly getByCode: (code: string) => Effect.Effect<IPCEntry | null>
  readonly getStatistics: (code: string) => Effect.Effect<IPCStats | null>
}
```

数据：`ipc_classification` 表（75929 条）+ `nodes` 中 IPC 类型节点（227 个，含无效率统计）。

### 3.6 PatentSearch Service

专利检索。默认不可用，需配置后端。

```ts
export interface Interface {
  readonly search: (query: SearchQuery) => Effect.Effect<PatentRecord[]>
  readonly isAvailable: () => Effect.Effect<boolean>
}
```

后端选项：`none`（默认）、`local`（PostgreSQL）、`google`（Google Patents API）、`custom`。

### 3.7 PatentWorkflow Service

工作流状态机。基于 OpenCode 的 `InstanceState` + Drizzle 持久化。

```ts
export interface Interface {
  readonly create: (type: WorkflowType, sessionId: string) => Effect.Effect<WorkflowState>
  readonly advance: (sessionId: string, action: string, output: string) => Effect.Effect<WorkflowState>
  readonly getState: (sessionId: string) => Effect.Effect<WorkflowState | null>
  readonly getCurrentStep: (state: WorkflowState) => Effect.Effect<Step | null>
  readonly reset: (sessionId: string) => Effect.Effect<void>
}
```

Drizzle schema：

```ts
export const WorkflowStateTable = sqliteTable("patent_workflow", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  workflow_type: text().notNull(),
  current_step: integer().notNull(),
  total_steps: integer().notNull(),
  status: text().notNull(),
  step_outputs: text().notNull(),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})
```

### 3.8 PatentQuality Service

7 维度质量检查 + 自动修复。

```ts
export interface Interface {
  readonly check: (input: QualityCheckInput) => Effect.Effect<QualityReport>
  readonly autoFix: (input: QualityCheckInput, report: QualityReport) => Effect.Effect<string>
}
```

7 维度（权重）：

| 维度 | 说明 | 权重 | 阈值 |
|------|------|------|------|
| completeness | 完整性 | 15% | ≥7.5 |
| clarity | 清晰性 | 15% | ≥7.5 |
| accuracy | 准确性 | 15% | ≥7.5 |
| sufficiency | 充分性 (A26.3) | 20% | ≥7.5 |
| consistency | 一致性 | 10% | ≥7.5 |
| compliance | 规范性 | 10% | ≥7.5 |
| support | 支持性 (A26.4) | 15% | ≥7.5 |

迭代策略：得分 < 7.5 自动修复，最多 3 次，超出标记人工审核。

### 3.9 PatentTemplate Service

文档模板。模板以 `.txt` 文件形式存放在 `src/patent/templates/`。

```ts
export interface Interface {
  readonly getSpecificationTemplate: (type: PatentType, inventionType: string) => Effect.Effect<string>
  readonly getClaimsTemplate: (type: PatentType) => Effect.Effect<string>
  readonly getOATemplate: () => Effect.Effect<string>
}
```

### 3.10 PatentDocument Service

文档格式转换。将 doc/docx/pdf/图片/音频转换为 Markdown，供后续步骤使用。

```ts
export interface Interface {
  readonly convertToMarkdown: (filePath: string, opts?: { ocr?: boolean }) => Effect.Effect<ConvertResult>
  readonly supportedFormats: () => Effect.Effect<string[]>
}
```

技术栈：
- DOCX/DOC：`mammoth`（已有依赖）→ HTML → `turndown` → Markdown
- PDF：`pdf-parse`（已有依赖）提取文本，扫描件通过 OCR
- 图片：OCR 识别文本 + 多模态模型理解附图
- 音频：通过 Provider 的多模态能力转录（如 Whisper API）
- TXT/MD：直接读取

### 3.11 PatentDrawing Service

技术图纸多模态理解。利用 OpenCode Provider 的多模态能力（attachment/image_url）识别附图。

```ts
export interface Interface {
  readonly analyzeDrawing: (image: Buffer | string, context?: string) => Effect.Effect<DrawingAnalysis>
  readonly extractDrawingElements: (image: Buffer | string) => Effect.Effect<DrawingElement[]>
}
```

技术栈：通过 OpenCode Provider Service 的多模态管线（FilePart/attachment），将图片发送给支持 vision 的模型（如 Claude、GPT-4o、Gemini）。不依赖外部 OCR 库。

---

## 4. Layer 2 专项工具

### 4.1 patent_convert（文档转换与图纸理解）

```ts
parameters: {
  action: "convert" | "analyze_drawing" | "batch_convert",
  filePath?: string,
  filePaths?: string[],
  image?: string,
  outputFormat?: "markdown" | "text" | "structured",
  ocr?: boolean,
  drawingContext?: string,
}
```

执行逻辑：
- `convert`：调用 PatentDocument Service 将 doc/docx/pdf/图片/音频转为 Markdown
- `analyze_drawing`：调用 PatentDrawing Service 用多模态模型识别技术图纸（结构、组件、标注、连接关系）
- `batch_convert`：批量转换多个文件

### 4.2 patent_research（法规研究）

```ts
parameters: {
  topic: string,
  scope?: "法规" | "案例" | "实务" | "知识库" | "ipc" | "全部",
  depth?: "概述" | "详细" | "深度",
}
```

执行逻辑：并行查询 PatentKG、PatentLaw、PatentKnowledge、PatentIPC → LLM 综合输出结构化研究报告。

### 4.2 patent_search（专利检索）

```ts
parameters: {
  query: string,
  field?: string,
  ipc?: string,
  applicant?: string,
  limit?: number,
}
```

执行逻辑：检查 `isAvailable()`，不可用时返回提示"请手动检索或配置后端"，可用时转发到对应后端。

### 4.3 patent_analyze（技术分析）

```ts
parameters: {
  action: "compare" | "novelty" | "inventiveness" | "prior_art",
  target: string,
  references?: string[],
  rules?: string,
}
```

执行逻辑：通过 Provider Service 调用 LLM 分析，可选查询 PatentKG 获取法条支撑。

### 4.4 patent_check（质量检查）

```ts
parameters: {
  document_type: "specification" | "claims" | "oa_response" | "full",
  content: string,
  auto_fix?: boolean,
}
```

执行逻辑：调用 PatentQuality Service 检查，`auto_fix=true` 且得分 < 7.5 时自动修复。

### 注册

在 `packages/opencode/src/tool/registry.ts` 的 `builtin` 数组中追加 5 个工具，与 `read`/`write`/`grep` 同级。工具只被 Layer 1 工作流 Agent 使用（通过 permission 控制）。

---

## 5. Layer 1 工作流 Agent

### 5.1 patent-draft（撰写工作流，5步）

基于 Athena 业务流程 `knowledge-graph-patent-drafting.md` 设计。

**Agent 定义**：

```ts
"patent-draft": {
  name: "patent-draft",
  description: "专利申请文件撰写。从技术交底书出发，5步骤产出完整申请文件。",
  mode: "subagent",
  prompt: PROMPT_PATENT_DRAFT,
  steps: 5,
  permission: Permission.merge(defaults, Permission.fromConfig({
    patent_convert: "allow",
    patent_research: "allow",
    patent_search: "allow",
    patent_analyze: "allow",
    patent_check: "allow",
    read: "allow",
    write: "allow",
  }), user),
  options: {},
}
```

**工作流步骤**：

#### 步骤 0：交底书预处理
- 判断输入格式：
  - 用户直接输入文本 → 直接使用
  - doc/docx/pdf/图片/音频文件 → 调用 patent_convert(action:"convert") 转为 Markdown
  - 含技术图纸 → 调用 patent_convert(action:"analyze_drawing") 识别图纸（结构、组件、标注、连接关系）
- 输出：标准化 Markdown 格式交底书（含图纸描述）
- 更新 todo 文件

#### 步骤 1/5：技术交底书理解
- 阅读交底书 → 提取三元组（技术问题→技术方案→技术效果）
- 识别必要技术特征和可选技术特征
- 输出 InventionUnderstanding（含置信度）
- 人机确认：展示三元组摘要（<300字）

#### 步骤 2/5：现有技术检索与对比分析
- 调用 patent_search 检索
- 调用 patent_research(scope:"ipc") 确定分类方向
- 三元组逐一比对 → 定位区别特征 → 确认发明点
- 人机确认：检索充分性 + 发明点确认

#### 步骤 3/5：说明书撰写（逐章节迭代）
- 按结构逐章节：技术领域→背景技术→发明内容→具体实施方式→附图说明
- 每章节完成后 patent_check 验证
- 得分 < 7.5 自动修复（最多 3 次，超出标记人工审核）

#### 步骤 4/5：权利要求撰写
- 布局规划 → 独立权利要求 → 从属权利要求（3-5层）
- patent_check 验证 A26.4 支持性
- 保护范围修改需用户明确批准

#### 步骤 5/5：摘要与整合
- 撰写摘要（300字）
- patent_check(document_type:"full") 最终一致性检查
- 输出完整申请文件

### 5.2 patent-oa（OA答复工作流，5步）

基于 Athena 业务流程 `knowledge-graph-oa-response.md` 设计。

**Agent 定义**：

```ts
"patent-oa": {
  name: "patent-oa",
  description: "审查意见答复。5步骤产出完整答复文件包。",
  mode: "subagent",
  prompt: PROMPT_PATENT_OA,
  steps: 5,
  permission: Permission.merge(defaults, Permission.fromConfig({
    patent_convert: "allow",
    patent_research: "allow",
    patent_search: "allow",
    patent_analyze: "allow",
    patent_check: "allow",
    read: "allow",
    write: "allow",
  }), user),
  options: {},
}
```

**工作流步骤**：

#### 步骤 1/5：审查意见解读与问题分解
- 输入：审查意见通知书（PDF/文本/图片）
- 如果是 PDF/图片 → 调用 patent_convert(action:"convert") 转为 Markdown
- 提取：驳回理由类型（A22.2/A22.3/A26.3/A26.4/A33）、对比文件、审查员论点、缺失特征
- 输出：OfficeAction 结构化 + 驳回理由清单
- 人机确认：确认驳回理由理解准确

驳回类型识别：

| 驳回理由 | 法律依据 | 严重程度 |
|---------|---------|---------|
| 新颖性问题 | A22.2 | 中等 |
| 创造性问题 | A22.3 | 严重 |
| 公开不充分 | A26.3 | 严重 |
| 权利要求不清楚 | A26.4 | 中等 |
| 修改超范围 | A33 | 严重 |

#### 步骤 2/5：驳回理由深度分析 + 法规调研
- 调用 patent_research 针对每个驳回理由涉及的法条深度调研
- 调用 patent_analyze 对比分析：
  - 新颖性 → 三元组逐一比对
  - 创造性 → 三步法（最接近现有技术→区别特征→技术启示→技术效果）
  - 公开不充分 → 实施方案检验
- 审查员视角模拟（LLM + patent_analyze）
- 人机确认：确认分析结果

#### 步骤 3/5：答复策略制定
- 基于分析结果制定多方案，展示策略选择矩阵：

| 场景 | 推荐策略 | 成功概率 | 风险等级 |
|------|---------|---------|---------|
| 审查员观点明显错误 | 完全反驳 | 70% | 中 |
| 部分认可，可修改克服 | 部分反驳+修改 | 85% | 低 |
| 完全认可，需缩小保护范围 | 完全接受+修改 | 95% | 极低 |
| 多个驳回理由组合 | 组合策略 | 75% | 中 |

- 人机确认：用户选择策略

#### 步骤 4/5：答复文本撰写
- 针对每个驳回理由撰写意见陈述书（审查员观点→申请人意见→技术对比→法律依据→结论）
- 权利要求修改（修改依据→修改内容标注→修改后文本）
- patent_check 验证答复质量
- 人机确认：逐条确认答复内容

#### 步骤 5/5：验证与打包
- patent_check(document_type:"full") 最终验证
- 输出完整答复文件包（意见陈述书 + 修改后权利要求）

### 5.3 Markdown Todo 跟踪

每个工作流启动时创建 todo markdown 文件，跟踪长周期任务进度。

**文件路径**：`.opencode/plans/patent-{type}-{timestamp}.md`

**patent-draft 示例**：

```markdown
# 专利撰写工作流 - [发明名称]

> 创建时间：2026-05-26 14:30
> 状态：进行中
> 专利类型：发明
> 发明类型：装置

## 步骤进度

### 步骤 0：交底书预处理
- [ ] 文档格式转换（docx/pdf → Markdown）
- [ ] 技术图纸识别（如有）
- [ ] 交底书标准化完成

### 步骤 1/5：技术交底书理解
- [x] 三元组提取（技术问题→技术方案→技术效果）
- [x] 必要技术特征识别
- [ ] 用户确认

### 步骤 2/5：现有技术检索与对比分析
- [ ] 关键词提取与检索
- [ ] IPC 分类确定
- [ ] 三元组对比分析
- [ ] 发明点定位
- [ ] 用户确认

### 步骤 3/5：说明书撰写
- [ ] 技术领域（50-100字）
- [ ] 背景技术（300-500字）
- [ ] 发明内容（800-1500字）
- [ ] 具体实施方式（1500-3000字）
- [ ] 附图说明
- [ ] 质量检查（得分：_）

### 步骤 4/5：权利要求撰写
- [ ] 权利要求布局规划
- [ ] 独立权利要求
- [ ] 从属权利要求（3-5层）
- [ ] A26.4 支持性检查
- [ ] 用户确认保护范围

### 步骤 5/5：摘要与整合
- [ ] 摘要撰写（300字）
- [ ] 最终质量检查
- [ ] 完整文件输出

## 中间产物
- 发明理解结果：[链接]
- 对比分析报告：[链接]
- 说明书草稿：[链接]
- 权利要求书：[链接]

## 备注
- 所有产出为草案状态，需专业审校后提交
```

**patent-oa 示例**：

```markdown
# 审查意见答复工作流 - [申请号]

> 创建时间：2026-05-26 14:30
> 状态：进行中

## 步骤进度

### 步骤 1/5：审查意见解读与问题分解
- [x] 审查意见解析
- [ ] 驳回理由清单确认

### 步骤 2/5：驳回理由深度分析
- [ ] 法规调研
- [ ] 三元组对比分析 / 三步法分析
- [ ] 审查员视角模拟
- [ ] 用户确认分析结果

### 步骤 3/5：答复策略制定
- [ ] 多方案制定
- [ ] 用户选择策略

### 步骤 4/5：答复文本撰写
- [ ] 意见陈述书
- [ ] 权利要求修改
- [ ] 质量验证

### 步骤 5/5：验证与打包
- [ ] 最终验证
- [ ] 答复文件包输出

## 中间产物
- 驳回理由清单：[链接]
- 对比分析报告：[链接]
- 答复策略方案：[链接]
- 意见陈述书：[链接]
- 修改后权利要求：[链接]
```

### 5.4 跨会话恢复

工作流状态持久化到 Drizzle，支持跨会话恢复：

```
用户关闭会话 → PatentWorkflow 状态持久化到 Drizzle
                    ↓
用户新会话："继续撰写XX专利"
  → build agent 调用 task(patent-draft, "继续")
  → patent-draft 读取 todo markdown 文件
  → PatentWorkflow.getState(sessionId) 恢复状态
  → 从断点继续执行
```

---

## 6. 配置体系

```jsonc
// opencode.jsonc
{
  "patent": {
    "dataDir": "/path/to/patent/data",
    "search": {
      "backend": "none" | "local" | "google" | "custom",
      "connectionString": "postgres://..."
    },
    "quality": {
      "threshold": 7.5,
      "maxIterations": 3
    },
    "agent": {
      "patent-draft": {
        "disable": false,
        "model": "deepseek/deepseek-reasoner"
      },
      "patent-oa": {
        "disable": false,
        "model": "deepseek/deepseek-reasoner"
      }
    }
  }
}
```

配置通过 `Config.Service` 加载，新增 `src/config/patent.ts` 模块，遵循现有 self-export 模式。

---

## 7. 目录结构

### 新增文件

```
packages/opencode/src/
├── patent/
│   ├── index.ts
│   ├── kg.ts
│   ├── knowledge.ts
│   ├── law.ts
│   ├── ipc.ts
│   ├── search.ts
│   ├── template.ts
│   ├── workflow.ts
│   ├── quality.ts
│   ├── document.ts              ← 文档格式转换
│   ├── drawing.ts               ← 图纸多模态理解
│   ├── workflow.sql.ts
│   ├── data/                    ← .gitignore 排除
│   │   ├── patent_kg.db              ← 符号链接
│   │   ├── semantic-index.db         ← 符号链接
│   │   ├── laws.db                   ← 符号链接
│   │   ├── cards/                    ← 复制（~2MB）
│   │   ├── 审查指南/                  ← 复制（~1MB）
│   │   └── 复审无效/                  ← 复制（~2MB）
│   └── templates/
│       ├── specification.txt
│       ├── claims-device.txt
│       ├── claims-method.txt
│       ├── claims-system.txt
│       ├── claims-composition.txt
│       └── oa-response.txt
├── agent/prompt/
│   ├── patent-draft.txt
│   └── patent-oa.txt
├── tool/
│   ├── patent-convert.ts
│   ├── patent-research.ts
│   ├── patent-search.ts
│   ├── patent-analyze.ts
│   └── patent-check.ts
└── config/
    └── patent.ts
```

### 修改文件

```
packages/opencode/src/
├── agent/agent.ts               ← 新增 patent-draft、patent-oa Agent 定义
├── tool/registry.ts             ← 注册 4 个专利 Tool
└── config/config.ts             ← 引入 patent 配置
```

---

## 8. 迁移路径

```
Phase 0（当前）
  opencode-patent-plugin（外部 plugin）+ YunPat（外部依赖）

Phase 1：第一批内置（本次设计范围）
  ├── patent-draft Agent（内置）
  ├── patent-oa Agent（内置）
  ├── 4 个 Layer 2 工具（内置）
  ├── 7+ Effect Service（内置）
  ├── 数据资产连接（部署时）
  └── opencode-patent-plugin 降级为可选兼容层

Phase 2：后续批次
  ├── patent-reexam Agent
  ├── patent-invalidation Agent
  └── 商标相关 Agent

Phase 3：移除 plugin
  └── 删除 opencode-patent-plugin 包
```

### Phase 1 实施顺序

```
Step 1: 数据资产连接
Step 2: Effect Services（无依赖，纯数据层）
Step 3: PatentQuality Service（依赖 Provider）
Step 4: Layer 2 工具（依赖 Services）
Step 5: Layer 1 Agent（依赖 Tools + Services）
Step 6: 注册到 agent.ts + registry.ts + 配置
```

---

## 9. 与 Professional Router 的关系

`professional-router-plugin` 保留，职责不变。路由目标从 plugin tools 变为内置 Agent：

```
之前：Router → patent_draft tool（plugin）
之后：Router → 建议调用 task(patent-draft, ...)（内置 Agent）
```

Router 系统提示词中引导主 Agent 调用对应的内置 subagent。

---

## 10. Service 依赖图

```
PatentDocument Service
  ├── mammoth (DOCX → HTML)
  ├── turndown (HTML → Markdown)
  ├── pdf-parse (PDF → text)
  └── Provider (音频转录)

PatentDrawing Service
  └── Provider (多模态 vision 模型)

PatentKG Service
  └── FileSystem (patent_kg.db)

PatentKnowledge Service
  ├── FileSystem (semantic-index.db + cards/)
  └── FileSystem (审查指南/ + 复审无效/)

PatentLaw Service
  └── FileSystem (laws.db)

PatentIPC Service
  └── FileSystem (patent_kg.db, ipc_classification 表)

PatentSearch Service
  └── HttpClient（可选后端）

PatentWorkflow Service
  ├── InstanceState (内存状态)
  └── Drizzle (持久化)

PatentQuality Service
  └── Provider (LLM)

PatentTemplate Service
  └── FileSystem (模板文件)
```

---

## 11. 约束与边界

- 不决定权利要求保护范围策略（用户决策）
- 不签署/提交法律文件
- 不直接提交专利申请或答复
- 涉及未公开发明内容的操作需用户明确审批
- 法条引用必须标注条款号
- 所有产出为草案状态，需专业审校后提交
- 专利检索默认不可用，不影响系统运行
