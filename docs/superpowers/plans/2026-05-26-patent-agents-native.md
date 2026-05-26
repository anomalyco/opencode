# 专利智能体内置化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将专利智能体（检索研究+撰写全链路）内置到 OpenCode 核心代码，完全解耦 YunPat 外部依赖。

**Architecture:** 两层架构 — Layer 1 为工作流 Agent（patent-draft、patent-oa），Layer 2 为专项 Tool（patent_convert、patent_research、patent_search、patent_analyze、patent_check），底层为 Effect Services（数据访问层）。Agent 和 Tool 注册到 OpenCode 现有的 Agent/ToolRegistry 系统。

**Tech Stack:** Effect v4、Drizzle (bun:sqlite)、SQLite (FTS5 + 向量)、Schema、Provider（多模态）、mammoth、turndown、pdf-parse

**Design Spec:** `docs/superpowers/specs/2026-05-26-patent-agents-native-design.md`

---

## File Structure

### 新增文件

```
packages/opencode/src/
├── patent/
│   ├── index.ts                        ← 自导出
│   ├── kg.ts                           ← PatentKG Service（知识图谱）
│   ├── knowledge.ts                    ← PatentKnowledge Service（语义检索+文件KB）
│   ├── law.ts                          ← PatentLaw Service（法律法规）
│   ├── ipc.ts                          ← PatentIPC Service（IPC分类）
│   ├── search.ts                       ← PatentSearch Service（可选检索后端）
│   ├── template.ts                     ← PatentTemplate Service（文档模板）
│   ├── workflow.ts                     ← PatentWorkflow Service（状态机）
│   ├── quality.ts                      ← PatentQuality Service（质量检查）
│   ├── document.ts                     ← PatentDocument Service（文档转换）
│   ├── drawing.ts                      ← PatentDrawing Service（图纸理解）
│   ├── workflow.sql.ts                 ← Drizzle schema
│   └── data/                           ← .gitignore 排除
│       ├── patent_kg.db                     ← 部署时符号链接
│       ├── semantic-index.db                ← 部署时符号链接
│       ├── laws.db                          ← 部署时符号链接
│       ├── cards/                           ← 复制
│       ├── 审查指南/                         ← 复制
│       └── 复审无效/                         ← 复制
├── agent/prompt/
│   ├── patent-draft.txt                ← 撰写工作流 prompt
│   └── patent-oa.txt                   ← OA答复工作流 prompt
├── tool/
│   ├── patent-convert.ts               ← 文档转换+图纸理解 Tool
│   ├── patent-research.ts              ← 法规研究 Tool
│   ├── patent-search.ts                ← 专利检索 Tool
│   ├── patent-analyze.ts               ← 技术分析 Tool
│   └── patent-check.ts                 ← 质量检查 Tool
└── config/
    └── patent.ts                       ← 专利配置模块

packages/opencode/test/
└── patent/
    ├── kg.test.ts
    ├── knowledge.test.ts
    ├── law.test.ts
    ├── ipc.test.ts
    ├── workflow.test.ts
    ├── quality.test.ts
    ├── document.test.ts
    ├── drawing.test.ts
    ├── patent-research.test.ts
    ├── patent-search.test.ts
    ├── patent-analyze.test.ts
    ├── patent-check.test.ts
    └── patent-convert.test.ts
```

### 修改文件

```
packages/opencode/src/
├── agent/agent.ts                      ← 新增 patent-draft、patent-oa Agent 定义
├── tool/registry.ts                    ← 注册 5 个专利 Tool
└── config/config.ts                    ← 引入 patent 配置
```

---

## Task 1: 专利配置模块

**Files:**
- Create: `packages/opencode/src/config/patent.ts`

- [ ] **Step 1: 创建配置模块**

遵循 `src/config/` 目录的 self-export 模式（参照 `agent.ts`、`command.ts` 等文件的顶部 `export * as ConfigXxx from "./xxx"` 模式）。

```ts
export * as ConfigPatent from "./patent"

import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { ConfigModelID } from "./model-id"
import { ConfigPermission } from "./permission"

export const PatentAgentConfig = Schema.Struct({
  disable: Schema.optional(Schema.Boolean),
  model: Schema.optional(ConfigModelID),
  temperature: Schema.optional(Schema.Finite),
  top_p: Schema.optional(Schema.Finite),
  prompt: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  steps: Schema.optional(Schema.Number),
  permission: Schema.optional(ConfigPermission.Info),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type PatentAgentConfig = Schema.Schema.Type<typeof PatentAgentConfig>

export const PatentSearchConfig = Schema.Struct({
  backend: Schema.optional(Schema.Literal("none", "local", "google", "custom")).pipe(
    Schema.withDefault(() => "none" as const),
  ),
  connectionString: Schema.optional(Schema.String),
})
export type PatentSearchConfig = Schema.Schema.Type<typeof PatentSearchConfig>

export const PatentQualityConfig = Schema.Struct({
  threshold: Schema.optional(Schema.Number).pipe(
    Schema.withDefault(() => 7.5),
  ),
  maxIterations: Schema.optional(Schema.Number).pipe(
    Schema.withDefault(() => 3),
  ),
})
export type PatentQualityConfig = Schema.Schema.Type<typeof PatentQualityConfig>

export const Info = Schema.Struct({
  dataDir: Schema.optional(Schema.String),
  search: Schema.optional(PatentSearchConfig),
  quality: Schema.optional(PatentQualityConfig),
  agent: Schema.optional(Schema.Record(Schema.String, PatentAgentConfig)),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>
```

- [ ] **Step 2: 在 config.ts 中引入 patent 配置**

在 `packages/opencode/src/config/config.ts` 的 `Info` Schema.Struct 中新增 `patent` 字段（在已有的 `agent` 字段附近），类型为 `Schema.optional(ConfigPatent.Info)`。同时在顶部 import 区新增 `import { ConfigPatent } from "./patent"`。

- [ ] **Step 3: typecheck 验证**

Run: `bun typecheck` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/config/patent.ts src/config/config.ts
git commit -m "feat(patent): add patent configuration module"
```

---

## Task 2: 数据资产连接与 .gitignore

**Files:**
- Create: `packages/opencode/src/patent/index.ts`
- Create: `packages/opencode/src/patent/data/.gitkeep`
- Modify: `packages/opencode/.gitignore`

- [ ] **Step 1: 创建 patent 模块目录和 index.ts**

```ts
export * as Patent from "."
```

- [ ] **Step 2: 创建 data 目录**

创建 `packages/opencode/src/patent/data/.gitkeep` 占位。

- [ ] **Step 3: 更新 .gitignore 排除数据资产**

在 `packages/opencode/.gitignore` 末尾追加：

```
# Patent data assets (deployed at runtime)
src/patent/data/*.db
src/patent/data/*.db-shm
src/patent/data/*.db-wal
src/patent/data/cards/
src/patent/data/审查指南/
src/patent/data/复审无效/
src/patent/data/legal-system/
```

- [ ] **Step 4: Commit**

```bash
git add src/patent/ .gitignore
git commit -m "feat(patent): add patent module structure and data gitignore"
```

---

## Task 3: PatentKG Service

**Files:**
- Create: `packages/opencode/src/patent/kg.ts`
- Create: `packages/opencode/test/patent/kg.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema, Context } from "effect"

const KGNode = Schema.Struct({
  id: Schema.String,
  node_type: Schema.String,
  name: Schema.String,
  title: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})
type KGNode = Schema.Schema.Type<typeof KGNode>

interface Interface {
  readonly queryNode: (name: string) => Effect.Effect<KGNode | null>
  readonly fullTextSearch: (query: string) => Effect.Effect<KGNode[]>
  readonly queryByLawRef: (ref: string) => Effect.Effect<KGNode[]>
}

class Service extends Context.Service<Service, Interface>()("@opencode/PatentKG") {}

const testLayer = Layer.succeed(Service, Service.of({
  queryNode: (name) => Effect.succeed(name === "三步法" ? { id: "1", node_type: "Concept", name: "三步法", title: "创造性判断三步法", content: "..." } : null),
  fullTextSearch: (query) => Effect.succeed(query.includes("创造性") ? [{ id: "1", node_type: "Concept", name: "三步法", title: "创造性判断", content: "..." }] : []),
  queryByLawRef: (ref) => Effect.succeed([]),
}))

describe("PatentKG Service", () => {
  test("queryNode returns matching node", async () => {
    const result = await Effect.runPromise(
      Effect.provide(Service.queryNode("三步法"), testLayer)
    )
    expect(result).not.toBeNull()
    expect(result!.name).toBe("三步法")
  })

  test("queryNode returns null for unknown", async () => {
    const result = await Effect.runPromise(
      Effect.provide(Service.queryNode("不存在概念"), testLayer)
    )
    expect(result).toBeNull()
  })

  test("fullTextSearch returns results", async () => {
    const results = await Effect.runPromise(
      Effect.provide(Service.fullTextSearch("创造性判断"), testLayer)
    )
    expect(results.length).toBeGreaterThan(0)
  })

  test("fullTextSearch returns empty for no match", async () => {
    const results = await Effect.runPromise(
      Effect.provide(Service.fullTextSearch("量子计算xyz"), testLayer)
    )
    expect(results).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test test/patent/kg.test.ts` (from `packages/opencode`)
Expected: FAIL — `@opencode/PatentKG` service not found（尚未实现）

- [ ] **Step 3: 实现 PatentKG Service**

在 `packages/opencode/src/patent/kg.ts` 中实现，使用 `Database` (bun:sqlite) 直接操作 `patent_kg.db`。遵循项目 Effect Service 模式（Context.Service + Layer.effect + self-export）。

核心实现要点：
- 通过 `Config.Service` 获取 `patent.dataDir` 定位 `patent_kg.db`
- `queryNode` → `SELECT * FROM nodes WHERE name = ?`
- `fullTextSearch` → `SELECT * FROM nodes_fts WHERE nodes_fts MATCH ?`
- `queryByLawRef` → `SELECT * FROM nodes WHERE full_ref LIKE ?`
- db 不存在时 Service 降级返回空结果（不阻塞系统启动）

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test test/patent/kg.test.ts` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patent/kg.ts test/patent/kg.test.ts
git commit -m "feat(patent): add PatentKG Service for knowledge graph queries"
```

---

## Task 4: PatentKnowledge Service

**Files:**
- Create: `packages/opencode/src/patent/knowledge.ts`
- Create: `packages/opencode/test/patent/knowledge.test.ts`

- [ ] **Step 1: 写测试**

测试语义检索和文件知识库查询的接口行为（使用 mock layer，不依赖实际数据库）。

```ts
import { describe, expect } from "bun:test"
import { Effect, Layer, Context } from "effect"

interface Interface {
  readonly searchSemantic: (query: string, opts: { limit: number; threshold: number }) => Effect.Effect<Array<{ title: string; content: string; score: number }>>
  readonly searchCards: (keyword: string) => Effect.Effect<Array<{ title: string; content: string }>>
  readonly searchGuidelines: (topic: string) => Effect.Effect<string>
  readonly searchInvalidation: (topic: string) => Effect.Effect<string>
}

class Service extends Context.Service<Service, Interface>()("@opencode/PatentKnowledge") {}

const testLayer = Layer.succeed(Service, Service.of({
  searchSemantic: (query, opts) => Effect.succeed(
    query.includes("三步法") ? [{ title: "创造性判断", content: "...", score: 0.9 }] : []
  ),
  searchCards: (keyword) => Effect.succeed(
    keyword.includes("创造性") ? [{ title: "创造性判断卡片", content: "..." }] : []
  ),
  searchGuidelines: (topic) => Effect.succeed(topic ? "审查指南相关内容" : ""),
  searchInvalidation: (topic) => Effect.succeed(topic ? "复审无效相关内容" : ""),
}))

describe("PatentKnowledge Service", () => {
  test("searchSemantic returns matching results", async () => {
    const results = await Effect.runPromise(
      Effect.provide(Service.searchSemantic("三步法", { limit: 5, threshold: 0.5 }), testLayer)
    )
    expect(results.length).toBe(1)
    expect(results[0].score).toBeGreaterThan(0.5)
  })

  test("searchSemantic returns empty for no match", async () => {
    const results = await Effect.runPromise(
      Effect.provide(Service.searchSemantic("不存在xyz", { limit: 5, threshold: 0.5 }), testLayer)
    )
    expect(results).toEqual([])
  })

  test("searchCards returns results", async () => {
    const results = await Effect.runPromise(
      Effect.provide(Service.searchCards("创造性判断"), testLayer)
    )
    expect(results.length).toBeGreaterThan(0)
  })

  test("searchGuidelines returns content", async () => {
    const result = await Effect.runPromise(
      Effect.provide(Service.searchGuidelines("新颖性"), testLayer)
    )
    expect(result.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test test/patent/knowledge.test.ts` (from `packages/opencode`)
Expected: FAIL

- [ ] **Step 3: 实现 PatentKnowledge Service**

在 `packages/opencode/src/patent/knowledge.ts` 中实现：
- `searchSemantic` → 查询 `semantic-index.db` 的 `chunks` 表（余弦相似度，bge-m3 1024维嵌入）
- `searchCards` → 读取 `cards/` 目录下的 .md 文件，关键词匹配
- `searchGuidelines` → 读取 `审查指南/` 目录，关键词匹配
- `searchInvalidation` → 读取 `复审无效/` 目录，关键词匹配
- 降级策略：db/目录不存在时返回空结果

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test test/patent/knowledge.test.ts` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patent/knowledge.ts test/patent/knowledge.test.ts
git commit -m "feat(patent): add PatentKnowledge Service for semantic search and file KB"
```

---

## Task 5: PatentLaw + PatentIPC Services

**Files:**
- Create: `packages/opencode/src/patent/law.ts`
- Create: `packages/opencode/src/patent/ipc.ts`
- Create: `packages/opencode/test/patent/law.test.ts`
- Create: `packages/opencode/test/patent/ipc.test.ts`

- [ ] **Step 1: 写 PatentLaw 测试**

```ts
import { describe, expect } from "bun:test"
import { Effect, Layer, Context } from "effect"

interface Interface {
  readonly searchLaw: (keyword: string) => Effect.Effect<Array<{ id: string; name: string; level: string }>>
  readonly getByCategory: (category: string) => Effect.Effect<Array<{ id: string; name: string }>>
  readonly getLawContent: (id: string) => Effect.Effect<string>
}

class Service extends Context.Service<Service, Interface>()("@opencode/PatentLaw") {}

const testLayer = Layer.succeed(Service, Service.of({
  searchLaw: (keyword) => Effect.succeed(
    keyword.includes("专利") ? [{ id: "1", name: "专利法", level: "法律" }] : []
  ),
  getByCategory: (category) => Effect.succeed(
    category === "法律" ? [{ id: "1", name: "专利法" }] : []
  ),
  getLawContent: (id) => Effect.succeed(id === "1" ? "专利法全文内容" : ""),
}))

describe("PatentLaw Service", () => {
  test("searchLaw returns matching laws", async () => {
    const results = await Effect.runPromise(
      Effect.provide(Service.searchLaw("专利法"), testLayer)
    )
    expect(results.length).toBeGreaterThan(0)
  })

  test("getLawContent returns content for known id", async () => {
    const content = await Effect.runPromise(
      Effect.provide(Service.getLawContent("1"), testLayer)
    )
    expect(content.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 写 PatentIPC 测试**

```ts
import { describe, expect } from "bun:test"
import { Effect, Layer, Context } from "effect"

interface Interface {
  readonly searchByDescription: (keyword: string) => Effect.Effect<Array<{ code: string; description: string }>>
  readonly getByCode: (code: string) => Effect.Effect<{ code: string; description: string; section: string } | null>
  readonly getStatistics: (code: string) => Effect.Effect<{ invalidation_rate: number; total_cases: number } | null>
}

class Service extends Context.Service<Service, Interface>()("@opencode/PatentIPC") {}

const testLayer = Layer.succeed(Service, Service.of({
  searchByDescription: (keyword) => Effect.succeed(
    keyword.includes("机器学习") ? [{ code: "G06N20/00", description: "机器学习" }] : []
  ),
  getByCode: (code) => Effect.succeed(
    code === "G06N20/00" ? { code: "G06N20/00", description: "机器学习", section: "G" } : null
  ),
  getStatistics: (code) => Effect.succeed(null),
}))

describe("PatentIPC Service", () => {
  test("searchByDescription finds IPC codes", async () => {
    const results = await Effect.runPromise(
      Effect.provide(Service.searchByDescription("机器学习"), testLayer)
    )
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].code).toMatch(/^G06N/)
  })

  test("getByCode returns null for unknown code", async () => {
    const result = await Effect.runPromise(
      Effect.provide(Service.getByCode("XX00/00"), testLayer)
    )
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `bun test test/patent/law.test.ts test/patent/ipc.test.ts` (from `packages/opencode`)
Expected: FAIL

- [ ] **Step 4: 实现 PatentLaw Service**

在 `packages/opencode/src/patent/law.ts` 中实现，操作 `laws.db`（SQLite），查询 `law` 和 `category` 表。

- [ ] **Step 5: 实现 PatentIPC Service**

在 `packages/opencode/src/patent/ipc.ts` 中实现，操作 `patent_kg.db` 的 `ipc_classification` 表（FTS5 搜索）和 `nodes`（IPC 类型，含无效率统计）。

- [ ] **Step 6: 运行测试确认通过**

Run: `bun test test/patent/law.test.ts test/patent/ipc.test.ts` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/patent/law.ts src/patent/ipc.ts test/patent/law.test.ts test/patent/ipc.test.ts
git commit -m "feat(patent): add PatentLaw and PatentIPC Services"
```

---

## Task 6: PatentSearch + PatentTemplate + PatentDocument + PatentDrawing Services

**Files:**
- Create: `packages/opencode/src/patent/search.ts`
- Create: `packages/opencode/src/patent/template.ts`
- Create: `packages/opencode/src/patent/document.ts`
- Create: `packages/opencode/src/patent/drawing.ts`
- Create: `packages/opencode/test/patent/search.test.ts`
- Create: `packages/opencode/test/patent/document.test.ts`

- [ ] **Step 1: 写测试**

`search.test.ts`：测试 `isAvailable()` 默认返回 false，`search()` 在不可用时返回错误。

`document.test.ts`：测试 `convertToMarkdown()` 对 .txt 和 .md 文件的处理。

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test test/patent/search.test.ts test/patent/document.test.ts` (from `packages/opencode`)
Expected: FAIL

- [ ] **Step 3: 实现 4 个 Service**

- **PatentSearch**：空壳实现，`isAvailable()` 读配置，未配置时返回 false
- **PatentTemplate**：从 `src/patent/templates/` 读取 .txt 模板文件
- **PatentDocument**：动态 import mammoth/turndown/pdf-parse，与现有 `document-parser.ts` 相同技术栈
- **PatentDrawing**：通过 Provider Service 的多模态能力发送图片给 vision 模型

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test test/patent/search.test.ts test/patent/document.test.ts` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patent/search.ts src/patent/template.ts src/patent/document.ts src/patent/drawing.ts test/patent/
git commit -m "feat(patent): add PatentSearch, PatentTemplate, PatentDocument, PatentDrawing Services"
```

---

## Task 7: PatentWorkflow Service

**Files:**
- Create: `packages/opencode/src/patent/workflow.sql.ts`
- Create: `packages/opencode/src/patent/workflow.ts`
- Create: `packages/opencode/test/patent/workflow.test.ts`

- [ ] **Step 1: 写测试**

测试 create → advance → getState → reset 的完整状态机流转。

```ts
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(/* workflow layer */)

describe("PatentWorkflow Service", () => {
  it.live("create and advance workflow", () =>
    Effect.gen(function* () {
      const workflow = yield* PatentWorkflow.Service
      const state = yield* workflow.create("draft", "test-session-1")
      expect(state.status).toBe("running")
      expect(state.currentStep).toBe(0)

      const advanced = yield* workflow.advance("test-session-1", "understand", "理解结果")
      expect(advanced.currentStep).toBe(1)
      expect(advanced.stepOutputs.understand).toBe("理解结果")
    })
  )

  it.live("getState returns null for unknown session", () =>
    Effect.gen(function* () {
      const workflow = yield* PatentWorkflow.Service
      const state = yield* workflow.getState("nonexistent")
      expect(state).toBeNull()
    })
  )

  it.live("reset clears workflow", () =>
    Effect.gen(function* () {
      const workflow = yield* PatentWorkflow.Service
      yield* workflow.create("draft", "test-session-2")
      yield* workflow.reset("test-session-2")
      const state = yield* workflow.getState("test-session-2")
      expect(state).toBeNull()
    })
  )
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test test/patent/workflow.test.ts` (from `packages/opencode`)
Expected: FAIL

- [ ] **Step 3: 写 Drizzle schema**

在 `packages/opencode/src/patent/workflow.sql.ts` 中定义 `WorkflowStateTable`（遵循项目 snake_case 命名和 `<entity>_id` join 列约定）。

- [ ] **Step 4: 实现 PatentWorkflow Service**

在 `packages/opencode/src/patent/workflow.ts` 中实现状态机，使用 `InstanceState` + Drizzle 持久化。工作流定义（draft 5步、oa 5步）内嵌为常量。

- [ ] **Step 5: 运行测试确认通过**

Run: `bun test test/patent/workflow.test.ts` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/patent/workflow.sql.ts src/patent/workflow.ts test/patent/workflow.test.ts
git commit -m "feat(patent): add PatentWorkflow Service with Drizzle persistence"
```

---

## Task 8: PatentQuality Service

**Files:**
- Create: `packages/opencode/src/patent/quality.ts`
- Create: `packages/opencode/test/patent/quality.test.ts`

- [ ] **Step 1: 写测试**

测试 7 维度质量评估的输出结构和阈值判定逻辑（使用 mock Provider）。

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test test/patent/quality.test.ts` (from `packages/opencode`)
Expected: FAIL

- [ ] **Step 3: 实现 PatentQuality Service**

在 `packages/opencode/src/patent/quality.ts` 中实现。通过 Provider Service 调用 LLM 进行 7 维度评估（completeness/clarity/accuracy/sufficiency/consistency/compliance/support），返回加权总分。`autoFix` 使用 LLM 根据评估报告修复，最多迭代 `maxIterations` 次。

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test test/patent/quality.test.ts` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patent/quality.ts test/patent/quality.test.ts
git commit -m "feat(patent): add PatentQuality Service with 7-dimension evaluation"
```

---

## Task 9: Layer 2 Tools（5个）

**Files:**
- Create: `packages/opencode/src/tool/patent-convert.ts`
- Create: `packages/opencode/src/tool/patent-research.ts`
- Create: `packages/opencode/src/tool/patent-search.ts`
- Create: `packages/opencode/src/tool/patent-analyze.ts`
- Create: `packages/opencode/src/tool/patent-check.ts`
- Create: `packages/opencode/test/patent/patent-convert.test.ts`
- Create: `packages/opencode/test/patent/patent-research.test.ts`
- Create: `packages/opencode/test/patent/patent-check.test.ts`

- [ ] **Step 1: 写 patent-convert 测试**

测试文档转换 Tool 对 txt/md 文件的处理，以及图纸识别 Tool 的参数校验。

- [ ] **Step 2: 写 patent-research 测试**

测试调用 patent_research 工具时并行查询各 Service 并汇总输出。

- [ ] **Step 3: 写 patent-check 测试**

测试质量检查 Tool 的参数校验和输出格式。

- [ ] **Step 4: 运行测试确认失败**

Run: `bun test test/patent/patent-convert.test.ts test/patent/patent-research.test.ts test/patent/patent-check.test.ts` (from `packages/opencode`)
Expected: FAIL

- [ ] **Step 5: 实现 5 个 Tool**

每个 Tool 遵循 `packages/opencode/src/tool/` 目录下的模式（`Tool.Info` 接口：`id` + `init()` → `{ description, parameters, execute }`），内部调用对应的 Effect Service。

- **patent-convert**：调用 PatentDocument + PatentDrawing
- **patent-research**：并行调用 PatentKG + PatentLaw + PatentKnowledge + PatentIPC，然后 Provider LLM 综合
- **patent-search**：调用 PatentSearch，不可用时返回提示
- **patent-analyze**：调用 Provider LLM 分析（对比/新颖性/创造性/现有技术）
- **patent-check**：调用 PatentQuality

- [ ] **Step 6: 运行测试确认通过**

Run: `bun test test/patent/patent-convert.test.ts test/patent/patent-research.test.ts test/patent/patent-check.test.ts` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/tool/patent-*.ts test/patent/patent-*.test.ts
git commit -m "feat(patent): add 5 Layer 2 patent tools"
```

---

## Task 10: 注册 Tools 到 ToolRegistry

**Files:**
- Modify: `packages/opencode/src/tool/registry.ts`

- [ ] **Step 1: 在 registry.ts 中导入并初始化 5 个专利 Tool**

在 `registry.ts` 中新增 `import` 和 `yield*` 初始化（参照现有 `WebFetchTool`、`GlobTool` 等的模式），追加到 `builtin` 数组。

- [ ] **Step 2: typecheck 验证**

Run: `bun typecheck` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tool/registry.ts
git commit -m "feat(patent): register 5 patent tools in ToolRegistry"
```

---

## Task 11: Agent Prompts

**Files:**
- Create: `packages/opencode/src/agent/prompt/patent-draft.txt`
- Create: `packages/opencode/src/agent/prompt/patent-oa.txt`

- [ ] **Step 1: 写 patent-draft prompt**

基于设计文档第 5.1 节的工作流步骤，撰写完整的 Agent 系统 prompt，包含：
- 角色定义（资深专利代理师）
- 步骤 0（交底书预处理）→ 步骤 1-5 的完整指引
- 每步调用哪些 Tool
- 人机交互确认节点
- Todo 文件创建和更新指引
- 约束条件（不决定保护范围、不提交、不签署等）
- 质量迭代策略（<7.5 自动修复，最多 3 次）

- [ ] **Step 2: 写 patent-oa prompt**

基于设计文档第 5.2 节，撰写完整的 OA 答复 Agent prompt，包含：
- 角色定义（资深专利代理师）
- 步骤 1-5 完整指引（含驳回类型识别表、策略选择矩阵、答复文本结构模板）
- 每步调用哪些 Tool
- 人机交互确认节点
- Todo 文件创建和更新指引
- 约束条件

- [ ] **Step 3: Commit**

```bash
git add src/agent/prompt/patent-draft.txt src/agent/prompt/patent-oa.txt
git commit -m "feat(patent): add patent-draft and patent-oa agent prompts"
```

---

## Task 12: 注册 Agents 到 Agent Service

**Files:**
- Modify: `packages/opencode/src/agent/agent.ts`

- [ ] **Step 1: 在 agent.ts 中新增 patent-draft 和 patent-oa Agent**

在 `agents` 对象中（`general` 之后），新增两个 Agent 定义。参照现有 `explore` agent 的模式：name、description、mode:"subagent"、prompt、permission、options。

权限配置包含 patent_convert、patent_research、patent_search、patent_analyze、patent_check、read、write 的 "allow"。

- [ ] **Step 2: typecheck 验证**

Run: `bun typecheck` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agent/agent.ts
git commit -m "feat(patent): register patent-draft and patent-oa as native agents"
```

---

## Task 13: 集成测试 + typecheck 全量验证

**Files:**
- Create: `packages/opencode/test/patent/integration.test.ts`

- [ ] **Step 1: 写集成测试**

测试 patent-draft 和 patent-oa Agent 能被 `Agent.Service.get()` 正确获取，permission 配置正确，Tool 能被 `ToolRegistry.Service.all()` 列出。

```ts
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"

describe("Patent Agent Integration", () => {
  test("patent-draft agent is registered", async () => {
    const agent = await runtime.runPromise(Effect.gen(function* () {
      const agents = yield* Agent.Service
      return yield* agents.get("patent-draft")
    }))
    expect(agent).toBeDefined()
    expect(agent.mode).toBe("subagent")
    expect(agent.prompt).toContain("专利")
  })

  test("patent-oa agent is registered", async () => {
    const agent = await runtime.runPromise(Effect.gen(function* () {
      const agents = yield* Agent.Service
      return yield* agents.get("patent-oa")
    }))
    expect(agent).toBeDefined()
    expect(agent.mode).toBe("subagent")
  })

  test("patent tools are registered", async () => {
    const tools = await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const all = yield* registry.all()
      return all.map(t => t.id)
    }))
    expect(tools).toContain("patent_research")
    expect(tools).toContain("patent_search")
    expect(tools).toContain("patent_analyze")
    expect(tools).toContain("patent_check")
    expect(tools).toContain("patent_convert")
  })
})
```

- [ ] **Step 2: 全量 typecheck**

Run: `bun typecheck` (from `packages/opencode`)
Expected: PASS

- [ ] **Step 3: 全量测试**

Run: `bun test` (from `packages/opencode`)
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add test/patent/integration.test.ts
git commit -m "test(patent): add integration tests for patent agents and tools"
```

---

## Self-Review

### Spec Coverage

| 设计文档章节 | 对应 Task |
|-------------|-----------|
| 3.1 存储分层 | Task 2 (data setup) |
| 3.2 PatentKG | Task 3 |
| 3.3 PatentKnowledge | Task 4 |
| 3.4 PatentLaw | Task 5 |
| 3.5 PatentIPC | Task 5 |
| 3.6 PatentSearch | Task 6 |
| 3.7 PatentWorkflow | Task 7 |
| 3.8 PatentQuality | Task 8 |
| 3.9 PatentTemplate | Task 6 |
| 3.10 PatentDocument | Task 6 |
| 3.11 PatentDrawing | Task 6 |
| 4.1 patent_convert | Task 9 |
| 4.2 patent_research | Task 9 |
| 4.3 patent_search | Task 9 |
| 4.4 patent_analyze | Task 9 |
| 4.5 patent_check | Task 9 |
| 5.1 patent-draft Agent | Task 11 + 12 |
| 5.2 patent-oa Agent | Task 11 + 12 |
| 5.3 Todo 跟踪 | Task 11 (prompt 内) |
| 5.4 跨会话恢复 | Task 7 (workflow persistence) |
| 6 配置体系 | Task 1 |
| 8 迁移路径 | 各 Task 按序执行 |

### Placeholder Scan

无 TBD/TODO/"implement later"/"fill in details"。所有步骤包含实际代码或明确指令。

### Type Consistency

- Service 接口名：`Interface`（所有 Service 统一）
- Service 类名：`Service extends Context.Service<Service, Interface>()(...)`
- Agent name：`"patent-draft"` / `"patent-oa"`（全文件一致）
- Tool id：`"patent_convert"` / `"patent_research"` / `"patent_search"` / `"patent_analyze"` / `"patent_check"`（全文件一致）
