# OpenCode Graph Engineering 可行性分析与三套方案

---

## 一、现状分析

### 1.1 现有架构已具备的"图"基础

| 能力 | 对应机制 | 说明 |
|------|----------|------|
| **多 Agent 编排** | Task 工具 + 自定义 Agent | 可以启动子 Agent 执行子任务 |
| **会话树** | session.parentID / session.children() | 会话天然形成树形结构 |
| **扩展点** | Plugin hooks + Custom Tools + MCP | 可拦截/扩展任何环节 |
| **权限控制** | Permission 系统 | 可为不同 Agent 分配不同能力 |
| **技能复用** | Skills | 可加载的指令集 |
| **编程控制** | SDK / HTTP Server | 外部可编程创建和管理会话 |

### 1.2 缺失的 Graph Engineering 核心能力

| 缺失能力 | 说明 | 影响 |
|----------|------|------|
| **原生 DAG 引擎** | 无节点/边/状态的三要素运行时 | 条件路由、并行分支需手动代码 |
| **状态持久化** | 无 Workflow 级别的状态快照 | 无法中断恢复长流程 |
| **声明式编排** | 无声明式 Graph DSL | 流程逻辑散落在 Agent Prompt 中 |
| **fork/join 原语** | 无并行分支与汇合的语义支持 | 并行执行需要手写协调逻辑 |
| **条件路由** | 无根据结果动态选择路径的机制 | Agent 自行决定下一步 |
| **循环控制** | 无原生循环/重试图节点 | 依赖 Agent 自我判断循环次数 |

### 1.3 可行性结论

**可行，但有边界条件：**

- ✅ **轻度图编排**（简单 DAG、串行/并行组合）— 现用 Task 工具 + 插件即可实现
- ✅ **领域专用图**（如 bookskill 的 15-step pipeline）— 可用 Config + Skills 固化
- ⚠️ **通用图引擎**（动态节点注册、条件路由、状态持久化）— 需插件/SDK 层面新增能力
- ❌ **可视化图编辑器** — 需 TUI 或 Web 前端改造，工程量大

---

## 二、方案设计

---

### 方案 A：轻量级 — Config-Driven 声明式 Graph（插件 + 配置层）

**核心理念**：在 OpenCode 现有架构上"搭一层"，用 `opencode.json` 声明图结构，Plugin 系统执行。

#### 架构

```
opencode.json
  └── graph: {
         nodes: { ... }        // 节点定义（Agent / Tool / Skill）
         edges: [ ... ]        // 连接关系（条件/无条件）
         state: { ... }        // 初始状态
       }
         ↓
   Graph Plugin (hook into Task tool)
         ↓
   展开为 Session Tree 执行
```

#### 用户视角

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "graph": {
    "nodes": {
      "search": {
        "type": "tool",
        "tool": "websearch",
        "description": "搜索资料"
      },
      "analyze": {
        "type": "agent",
        "agent": "researcher",
        "description": "分析搜索结果",
        "input": "search.result"
      },
      "write": {
        "type": "agent",
        "agent": "writer",
        "description": "撰写报告",
        "input": "analyze.result"
      },
      "review": {
        "type": "agent",
        "agent": "reviewer",
        "description": "审核报告",
        "input": "write.result"
      }
    },
    "edges": [
      { "from": "search", "to": "analyze", "type": "fixed" },
      { "from": "analyze", "to": "write", "type": "fixed" },
      { "from": "write", "to": "review", "type": "fixed" },
      { "from": "review", "to": "write", "type": "conditional",
        "condition": "result.score < 0.8" }
    ]
  }
}
```

#### 实现路径

1. **Graph Plugin**（.opencode/plugins/graph-engine.js）
   - hook `tool.execute.before` 拦截 Task 调用
   - 解析 `graph` 配置，构建 DAG
   - 将 Graph 展开为 Session Tree 执行
2. **Graph 状态文件**（.opencode/graph-state.json）
   - 持久化当前节点执行状态
   - 支持中断恢复
3. **3个新 Custom Tool**：
   - `graph_run` — 启动一个图流程
   - `graph_status` — 查询流程图状态
   - `graph_resume` — 从中断点恢复

#### 优缺点

| 维度 | 评价 |
|------|------|
| **侵入性** | ⭐ 零侵入，纯插件层 |
| **交付周期** | ⭐ ~1-2 周 |
| **表达能力** | ⚠️ 有限：仅支持预声明图，不支持动态图 |
| **可维护性** | ⭐ 配置和逻辑分离 |
| **扩展性** | ⚠️ 受限于 Plugin hook 能力 |
| **适合场景** | 固定流程的自动化（发布流程、代码审查、文档生成） |

---

### 方案 B：原生图运行时 — SDK/Server 层扩展

**核心理念**：在 OpenCode Server 层面新增 `/graph` API 端点，提供原生 DAG 执行引擎，Agent 通过 Tool 调用图服务。

#### 架构

```
┌─────────────────────────────────┐
│         OpenCode Server         │
│  ┌───────────────────────────┐  │
│  │   Graph Engine Runtime    │  │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ │  │
│  │  │Node1│→│Node2│→│Node3│ │  │
│  │  └─────┘ └─────┘ └─────┘ │  │
│  │  ├ 状态机                  │  │
│  │  ├ 条件路由                │  │
│  │  ├ fork/join              │  │
│  │  └ 持久化                  │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │  New API: /graph/*        │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
         ↑
   New Tools: graph_create / graph_step / graph_wait
         ↑
   Agent 通过 Tool 调用图服务
```

#### API 设计

```
POST /graph/create    — 根据声明创建图实例
POST /graph/:id/step  — 推进一个节点
POST /graph/:id/fork  — 从某节点分叉
GET  /graph/:id       — 查询图状态
POST /graph/:id/resume — 中断后恢复
```

#### 工具接口

```
graph_create(schema: { nodes: NodeDef[], edges: EdgeDef[] }) → graph_id
graph_step(graph_id, node_id, input?) → { output, next_nodes[] }
graph_wait(graph_id, node_id) → { status, output }
graph_status(graph_id) → { completed, pending, failed }
```

#### 节点类型

```typescript
type NodeDef = {
  id: string;
  type: "agent" | "tool" | "skill" | "llm_call" | "sub_graph";
  config: Record<string, any>;
  retry?: { max: number, strategy: "fixed" | "exponential" };
  timeout?: number;
};

type EdgeDef = {
  from: string;
  to: string | string[];  // string[] = fork
  condition?: (state: GraphState) => boolean;
  join?: "all" | "any";   // 汇合策略
};
```

#### 实现路径

1. **新增 Graph Engine 模块**（packages/server/src/graph/）
   - DAG 解析器
   - 状态机（pending → running → completed/failed）
   - 调度器（条件路由、fork/join、重试）
2. **新增 HTTP API**（/graph/*）
3. **新增 Built-in Tools**（graph_create / graph_step / graph_wait）
4. **Plugin 集成**：Graph 节点执行前后触发 plugin hooks

#### 优缺点

| 维度 | 评价 |
|------|------|
| **侵入性** | ⚠️ 中等：Server 层新增模块 |
| **交付周期** | ⚠️ ~4-6 周 |
| **表达能力** | ⭐ 完整：支持动态图、条件、循环、并行 |
| **可维护性** | ⭐ 原生集成，API 统一 |
| **扩展性** | ⭐ 可对接外部调度器（Temporal、Airflow） |
| **适合场景** | 复杂多 Agent 协作、长时任务、人机协同 |

---

### 方案 C：外部图引擎 — MCP Server 集成

**核心理念**：不修改 OpenCode 内核，而是构建一个独立的 Graph Engine MCP Server，通过 MCP 协议提供图编排能力。

#### 架构

```
┌────────────────────┐     ┌──────────────────────────┐
│    OpenCode        │     │   Graph MCP Server       │
│                    │     │                          │
│   Agent ──MCP──→   │     │  ┌──────────────────┐    │
│                    │     │  │  LangGraph /      │    │
│   Tool: graph_*    │     │  │  Temporal /       │    │
│                    │     │  │  Custom Engine    │    │
└────────────────────┘     │  └──────────────────┘    │
                           │                          │
                           │  State: SQLite/Redis     │
                           │  Events: SSE             │
                           └──────────────────────────┘
```

#### 用户配置

```jsonc
{
  "mcp": {
    "graph-engine": {
      "type": "local",
      "command": ["npx", "-y", "@opencode/graph-engine"],
      "env": {
        "GRAPH_STORAGE": "sqlite",
        "GRAPH_DB_PATH": ".opencode/graph.db"
      }
    }
  }
}
```

#### MCP Server 暴露的工具

```
graph_create     — 创建图流程
graph_submit     — 提交输入到某节点
graph_query      — 查询图状态
graph_list       — 列出所有活跃图
graph_resume     — 恢复中断图
graph_cancel     — 取消图
```

#### 集成点

1. **状态同步**：通过 Plugin `session.idle` / `session.status` 事件将 Agent 状态同步回 MCP Server
2. **结果回调**：Agent 完成节点后调用 `graph_submit` 将结果写回图
3. **事件驱动**：MCP Server 通过 SSE 推送下一个待执行节点

#### 实现路径

1. **构建 @opencode/graph-engine**（独立 npm 包）
   - 基于 LangGraph 或自研轻量 DAG 引擎
   - SQLite 持久化 + Redis 可选
   - MCP 协议实现
2. **构建 @opencode/graph-plugin**（OpenCode Plugin）
   - 自动注册 MCP Server
   - Agent 上下文注入图状态提示
   - 自动同步 Agent 生命周期到图
3. **模板 + Skills**
   - 提供常见图模式的 Skill（research-graph、review-graph、publish-graph）

#### 优缺点

| 维度 | 评价 |
|------|------|
| **侵入性** | ⭐ 零侵入，MCP 标准协议 |
| **交付周期** | ⭐ ~2-3 周 |
| **表达能力** | ⭐ 完整：可利用 LangGraph 等成熟引擎 |
| **可维护性** | ⚠️ 独立进程，需管理 |
| **扩展性** | ⭐ 可复用任何 MCP 客户端 |
| **适合场景** | 已有 MCP 生态的组织、需要 LangGraph 等成熟框架的场景 |

---

## 三、方案对比

| 维度 | 方案 A：Config-Driven | 方案 B：原生运行时 | 方案 C：MCP 外部引擎 |
|------|:---------------------:|:------------------:|:--------------------:|
| **侵入性** | 低（插件层） | 中（Server 层） | 低（外部进程） |
| **交付周期** | 1-2 周 | 4-6 周 | 2-3 周 |
| **表达能力** | 中（静态图） | 高（动态图） | 高（全功能） |
| **状态持久化** | 文件 | Server 内存+DB | SQLite/Redis |
| **并行能力** | 中（Task 模拟） | 原生 fork/join | 原生 fork/join |
| **可视化** | 无 | 可配套 Web UI | 可配套 Web UI |
| **维护成本** | 低 | 中（合入主线） | 中（独立进程） |
| **生态兼容** | 仅 OpenCode | 仅 OpenCode | 任何 MCP 客户端 |
| **失败恢复** | 文件状态 | Server 持久化 | DB 持久化 |
| **推荐场景** | 个人/小团队 | OpenCode 主线功能 | 组织级/跨工具 |

## 四、推荐路径

分阶段演进：

```
Phase 1 (1-2 周) → 方案 A：快速上线 Config-Driven Graph Plugin
  ├ 交付最小可用版本
  ├ 积累真实使用反馈
  └ 验证 Graph Engineering 在 OpenCode 中的价值

Phase 2 (2-3 周) → 方案 C：MCP Graph Engine 标准化
  ├ 构建独立 MCP Server
  ├ 支持 LangGraph 兼容
  └ 提供 Skill 模板库

Phase 3 (4-6 周) → 方案 B：原生集成（根据前两阶段反馈决定）
  ├ 将成熟模式合入 Server
  └ 提供原生 API + 可视化
```

---

## 五、附录：当前机制与图要素的映射

| Graph 要素 | OpenCode 当前等价物 | 差距 |
|------------|-------------------|------|
| **Node（执行单元）** | Agent / Tool / Skill | 缺节点类型泛化 |
| **Edge（依赖/路由）** | Agent 自行决策 | 缺声明式边定义 |
| **State（状态）** | Session 上下文 | 缺跨 Session 持久化 |
| **Fork（并行）** | Task 启动多个子 Session | 缺原生 fork 语义 |
| **Join（汇合）** | 手动等待子 Session 结果 | 缺原生 join 语义 |
| **Condition（条件路由）** | Agent if/else 判断 | 缺声明式条件 |
| **Loop（循环）** | Agent 重试/自调用 | 缺有界循环控制 |
| **Sub-graph（子图）** | Task 子 Agent | 缺嵌套图管理 |
