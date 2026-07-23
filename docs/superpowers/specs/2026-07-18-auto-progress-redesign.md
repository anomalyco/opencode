# Auto-Progress 系统重新设计

**Date:** 2026-07-18
**Status:** Partially superseded by ADR-0002 Amendment 2026-07-18
**Supersedes:** `packages/opencode/src/issue/auto-progress.ts` (current implementation)
**Related ADRs:** ADR-0001, ADR-0002 (含 Amendments 2026-07-11 / 2026-07-12 / 2026-07-18), ADR-0003, ADR-0004

> **⚠ SUPERSEDED SECTIONS NOTICE (2026-07-19):**
> ADR-0002 Amendment 2026-07-18 §D12-revised supersedes the following
> sections of this spec. The ADR is authoritative; this spec is retained
> for historical context only.
>
> - **§4 (AutoProgress 引擎规则)** — Rule 1 / Rule 2 are **no longer
>   implemented**. The engine is deleted; the agent model is pure pull.
> - **§5.5 (`issue_auto_progress` 保留)** — the tool is **deleted**.
> - **§8.4 (保留当前实现)** — `auto-progress.ts` is **deleted**, not kept.
> - **§10.1 (保留现有测试)** — `test/issue/auto-progress.test.ts` is
>   **deleted**.
> - **§10.3 Standards 修复 (移除 `isActive`)** — moot, the whole file is gone.
> - **§11.1 第 5/6 项 (修改 `issue_auto_progress.ts/.txt`、移除
>   `auto-progress.ts` 中 `isActive`)** — moot, both files are deleted.
> - **§11.3 不做的事 (不重写 AutoProgress 引擎核心规则)** — the engine is
>   now entirely removed, not just "not rewritten".
> - **§13 验收标准 #6 / #9** — both moot: there is no engine whose rules
>   are preserved, and no `issue_auto_progress.txt` to update.
>
> The remaining sections (§3 status classification, §5.1 `issue_list`
> filtering, §5.2 `issue_archive`, §5.4 `issue_delete` constraints,
> §6 UI behaviour, §9 Linear sync) remain accurate and reflect the
> implemented design.

---

## 1. 背景与动机

### 1.1 当前实现的问题

当前 `auto-progress.ts` 是 Todo Sidebar Feature 初版交付时的状态级联引擎，仅做两件事：

- **Rule 1**：L1 处于 `In Progress` / `In Review` 且所有 L2 已完成 → L1 自动标 `Done`
- **Rule 2**：无 active L1 时，首个 `Todo` L1 → `In Progress`；其 `Todo` L2 → `In Progress`

该实现存在以下与 Todo Sidebar 系统目标的偏离：

1. **未服务"人作为编排者"语义**。当前引擎仅做状态推进，不暴露"完成并归档"的显式动作，Agent 完成 L2 后只能通过 `issue_update({ status: "Done" })` 间接表达，缺少语义化入口。
2. **归档态与活跃态在读取层未分离**。`issue_list` 返回所有 issue，Agent 必须自行过滤，容易把已归档的 L1/L2 重新纳入规划，违反"归档即终结"的契约。
3. **L1 归档与 L2 状态耦合不清**。当前实现假设 L1 归档时其 L2 也应级联归档，但实际语义上 L1 归档只是"该任务整体不再活跃"，L2 的状态记录应保留以供历史查看。
4. **用户与 Agent 操作模型不统一**。UI 上"删除"按钮与 Agent 的 `issue_delete` 工具语义重叠但触发条件不同，缺少统一的"x"按钮抽象。

### 1.2 新需求

Todo Sidebar 系统已与 Linear Issue 完全对齐（Label / Status / Title / Description / Priority / Due Date / Assignee 等）。新需求下：

- **L1 待办是任务导向**：用户作为编排者，通过 L1 指导多个任务的规划与推进
- **L2 待办是具体执行指标**：Agent 作为执行者，按 L2 顺序完成
- **用户可干预 L2**：影响 Agent 在任务过程中的规划
- **用户可干预 L1**：指导多个任务的规划和推进
- **Agent 主动 pull**：每轮任务开始时读取待办，用户编辑自然在下一轮生效，无需实时事件推送
- **已归档 issue 不可编辑**：进入终态后只读，仅可删除

### 1.3 与原 in-session Todo 的关系

原 in-session Todo（`packages/opencode/src/session/todo.ts` + `TodoWriteTool`）保留不动，它服务于 Agent 在单次任务内的临时规划，用户不可见、不可编辑。**本次重新设计不合并两者**，数据隔离：`session.todo` 表 vs `issue` 表。

---

## 2. 设计目标

1. **纯状态机定位**：auto-progress 引擎只做状态级联，不驱动 Agent loop，不推送事件给 Agent
2. **Agent 主动 pull + 主动归档**：Agent 每轮 `issue_list` 读取待办；完成 L2 后显式 `issue_archive` 归档
3. **归档不级联**：归档操作只改单个 issue 的 status，L1 归档后其 L2 状态保持不变但不再被读取
4. **读取按 L1 归档态过滤**：`issue_list` 默认仅返回非归档 L1 及其非归档 L2，归档子树自然不进入 Agent 视野
5. **用户单一"x"按钮**：Active issue 点击"x" → 归档；Archived issue 点击"x" → 删除
6. **服务端约束统一**：`issue_delete` 拒绝 Active issue；`issue_archive` 幂等
7. **与 Linear 字段对齐**：归档态对应 Linear 的 Done / Canceled / Duplicate 状态

---

## 3. 核心概念

### 3.1 状态分类

| 分类         | Status 集合                                   | 语义                                             |
| ------------ | --------------------------------------------- | ------------------------------------------------ |
| **Active**   | `Backlog`, `Todo`, `In Progress`, `In Review` | 可编辑、可被 Agent 读取、可被 auto-progress 推进 |
| **Archived** | `Done`, `Canceled`, `Duplicate`               | 只读、不被 Agent 默认读取、仅可删除              |

### 3.2 层级语义

- **L1（level=0）**：任务导向，由用户编排。同一时刻至多一个 L1 处于 `In Progress` / `In Review`（顺序执行约束）
- **L2（level=1）**：具体执行指标，隶属于 L1。同一 L1 下的 L2 可并行推进

### 3.3 归档语义

归档是"任务终结"的显式动作，由 Agent 或用户触发。**归档不级联**：

- L1 归档 → L2 状态保持不变，但因 L1 归档，整个子树（L1 + L2）不再被 `issue_list` 默认返回
- L2 归档 → L1 与兄弟 L2 不受影响
- 已归档 issue 再次归档 → 幂等成功，不改状态

---

## 4. AutoProgress 引擎规则

### 4.1 Rule 1：L2 全归档 → L1 自动 Done

**触发条件**：

- L1 处于 `In Progress` 或 `In Review`
- 该 L1 下**至少有一个 L2** 且所有 L2 ∈ Archived

**动作**：

- L1.status = `Done`
- time_updated 更新

**说明**：此时 L1 下的 L2 都已各自归档（由 Agent 或用户显式归档），Rule 1 仅做收尾。引擎不主动归档 L2。

**边界**：无 L2 的空 L1 不触发 Rule 1（避免误把刚提升的 L1 立即标 Done）。空 L1 的归档由 Agent / 用户显式 `issue_archive` 触发。

### 4.2 Rule 2：提升首个 Todo L1

**触发条件**：

- 当前无 active L1（无 L1 处于 `In Progress` / `In Review`）
- 存在 status = `Todo`（非 Backlog）的 L1

**动作**：

- 首个 `Todo` L1.status = `In Progress`
- 该 L1 下所有 `Todo` L2.status = `In Progress`

**守卫**：

- `hasActive` 检查：若已有 L1 active，不再提升新 L1（顺序执行约束）

**说明**：Backlog 状态的 L1 不参与提升，等待用户显式改为 Todo。

### 4.3 触发时机

- `start(directory)`：初次激活时调用 `advance(directory)`
- `Issue.Updated` 事件订阅器：收到事件后调用 `tick(directory)`，tick 内部检查 directory 是否在 active 集合，是则调用 `advance`

### 4.4 不做的事

- 不主动归档 L2（L2 归档由 Agent / 用户显式触发）
- 不级联 L1 归档到 L2
- 不推送事件给 Agent
- 不记录 focus 指针
- 不调度 Agent loop

---

## 5. Agent 工具集

### 5.1 `issue_list`（修改默认行为）

```
issue_list({
  directory: string,
  include_archived?: boolean,   // 默认 false
})
```

**默认行为**（`include_archived` 未传或 false）：

- 返回所有非归档 L1
- 每个 L1 下返回其非归档 L2
- 归档 L1 的整个子树（L1 + L2）不返回
- 归档 L2 不返回（即使其 L1 活跃）

**`include_archived: true`**：

- 返回所有 L1 / L2（含归档）
- 用于 UI 归档区折叠展示与管理视图

**Agent 默认不传 `include_archived`**，自然只看到活跃待办。

### 5.2 `issue_archive`（新增）

```
issue_archive({
  id: string,
  outcome: "done" | "canceled" | "duplicate",
})
```

**行为**：

1. 加载 issue by id
2. 若 issue.status ∈ Archived → 幂等返回成功，不改状态
3. 更新 issue.status = outcome, time_updated = now
4. 发布 `Issue.Updated` 事件
5. AutoProgress 订阅器接收 → tick(directory) → 可能触发 Rule 1（L2 归档后 L1 检查）

**不级联**：L1 归档不修改其 L2 状态；L2 归档不修改 L1 状态。

### 5.3 Agent 归档触发场景

| #   | 触发条件                  | Agent 动作                                 | 后续                                     |
| --- | ------------------------- | ------------------------------------------ | ---------------------------------------- |
| 1   | L2 完成                   | `issue_archive(L2, done)`                  | 读取下一个非归档 L2 继续执行             |
| 2   | L1 完成（其 L2 全部归档） | `issue_archive(L1, done)`                  | 读取下一个非归档 L1                      |
| 3a  | L2 取消/重复              | `issue_archive(L2, canceled \| duplicate)` | 跳过当前 L2，进行下一个 L2               |
| 3b  | L1 取消/重复              | `issue_archive(L1, canceled \| duplicate)` | 跳过当前 L1（其 L2 不动），进行下一个 L1 |

### 5.4 `issue_delete`（约束修改）

```
issue_delete({ id: string })
```

**新约束**：

- Active issue → 拒绝，抛 `IssueNotArchivedError`
- Archived L1 → 硬删除 L1 + 级联硬删除其所有 L2（孤儿 L2 无意义）
- Archived L2 → 硬删除 L2，L1 不受影响

**与 Linear 同步**：本地删除不影响 Linear 端 issue（Linear MCP 无 delete API）。

### 5.5 其他工具（保留现状）

- `issue_add`：创建 L1 / L2（保留）
- `issue_update`：改字段（保留，归档态拒绝）
- `issue_reorder`：重排 L1 顺序（保留，归档态拒绝）
- `issue_auto_progress`：start / stop / status（保留）

### 5.6 归档态保护

以下工具对 Archived issue 抛 `IssueArchivedError`：

- `issue_update`
- `issue_reorder`
- `issue_delete`（Active 时抛 `IssueNotArchivedError`；Archived 时允许）

Agent 工具捕获错误后返回友好提示。

---

## 6. 用户 UI 行为

### 6.1 单一"x"按钮

| Issue 状态      | 点击"x"                     | 服务端动作                |
| --------------- | --------------------------- | ------------------------- |
| Active L1 或 L2 | 归档（outcome=Done）        | `issue_archive(id, done)` |
| Archived L1     | 硬删除 L1 + 级联硬删除其 L2 | `issue_delete(id)`        |
| Archived L2     | 硬删除 L2                   | `issue_delete(id)`        |

**视觉**：

- Active issue 卡片右上角"x"图标，hover 提示"归档"
- Archived issue 卡片右上角"x"图标，hover 提示"删除"

### 6.2 归档区折叠

- 默认折叠"归档"区
- 展开时通过 `issue_list({ include_archived: true })` 加载
- 归档区 issue 灰化、只读、"x"按钮提示"删除"

### 6.3 用户干预路径

所有用户编辑操作**不实时通知 Agent**，在 Agent 下一轮 `issue_list` 时自然生效：

| 用户操作                           | 对 Agent 的影响（下一轮） |
| ---------------------------------- | ------------------------- |
| 重排 L1（改 position）             | 按新顺序推导活跃 L1       |
| 把 Backlog L1 改为 Todo            | 可被 Rule 2 提升          |
| 添加 L2 到活跃 L1                  | 看到新子任务              |
| 删除活跃 L1 的最后一个 Todo L2     | Rule 1 可能将 L1 标 Done  |
| 手动把 L2 从 In Progress 改回 Todo | 重新执行该 L2             |
| 手动"x"归档 Active L1              | 整个子树不再被读取        |
| 手动"x"归档 Active L2              | Rule 1 可能级联 L1 Done   |
| 手动"x"删除 Archived L1            | L2 同步硬删除             |

---

## 7. 数据模型

**无新表，无新迁移。** 完全复用 `IssueTable`：

- `status` 字段决定 Active / Archived 分类
- `position` 字段决定 L1 顺序（用户重排即改 position）
- `level` 区分 L1（0）/ L2（1）
- `parent_id` 标识 L2 所属 L1
- Linear 字段（labels / priority / due_date / assignee_id / linear_issue_id）已对齐，不动

### 7.1 新增错误类型

```typescript
// 在 issue.ts 中新增
export class IssueArchivedError extends Schema.TaggedErrorClass<IssueArchivedError>()("Issue.ArchivedError", {
  id: Schema.String,
}) {}

export class IssueNotArchivedError extends Schema.TaggedErrorClass<IssueNotArchivedError>()("Issue.NotArchivedError", {
  id: Schema.String,
}) {}
```

---

## 8. 服务端实现要点

### 8.1 `issue_list` 查询逻辑

```typescript
// 伪代码
const all = yield * db.select().from(IssueTable).where(eq(IssueTable.directory, directory))
const archived = input.include_archived ?? false

if (archived) return all

// 默认过滤：L1 非归档 + L2 非归档 + L2 的 parent 非归档
const activeL1Ids = new Set(all.filter((i) => i.level === 0 && !ARCHIVED.has(i.status)).map((i) => i.id))
return all.filter((i) => {
  if (i.level === 0) return activeL1Ids.has(i.id)
  return activeL1Ids.has(i.parent_id!) && !ARCHIVED.has(i.status)
})
```

### 8.2 `issue_archive` 实现要点

```typescript
// 伪代码
const issue = yield * issue.get({ directory, id })
if (ARCHIVED.has(issue.status)) return // 幂等

yield * db.update(IssueTable).set({ status: outcome, time_updated: Date.now() }).where(eq(IssueTable.id, id))

yield * publish(directory) // 触发 Issue.Updated → AutoProgress tick
```

### 8.3 `issue_delete` 约束

```typescript
const issue = yield * issue.get({ directory, id })
if (!ARCHIVED.has(issue.status)) {
  yield * Effect.fail(new IssueNotArchivedError({ id }))
}

// L1 级联硬删 L2
if (issue.level === 0) {
  yield * db.delete(IssueTable).where(eq(IssueTable.parent_id, id))
}
yield * db.delete(IssueTable).where(eq(IssueTable.id, id))
```

### 8.4 AutoProgress 引擎（保留当前实现）

当前 `auto-progress.ts` 工作树版本（含 `hasActive` 守卫、全局 `Ref<HashSet>` 注册表、`Issue.Updated` 订阅器）已符合本设计，无需重写。仅需：

- 移除 `isActive` 方法（不在 spec 中，JUDGEMENT 项清理）
- 更新 `issue_auto_progress.txt` 描述，明确"引擎只做级联，Agent 通过 issue_list 读取"

---

## 9. 与 Linear 同步

### 9.1 归档推送

- `issue_archive(id, done)` → Linear state = Done
- `issue_archive(id, canceled)` → Linear state = Canceled
- `issue_archive(id, duplicate)` → Linear state = Duplicate

推送逻辑沿用现有 SyncPush 的 shadow diff 机制。

### 9.2 归档拉取

- Linear 端 issue 进入 Done / Canceled / Duplicate → 本地 issue 同步归档
- 拉取逻辑沿用现有 SyncPull 的三态决策（INSERT / SKIP / UPDATE）

### 9.3 删除同步

- 本地 `issue_delete` 不影响 Linear 端 issue（Linear MCP 无 delete API）
- Linear 端 issue 被删 → 本地硬删除（如果已归档）或保留为孤儿（如果 Active，等待用户决策）

---

## 10. 测试策略

### 10.1 保留现有测试

保留 `test/issue/auto-progress.test.ts` 中 9 个用例（已通过）。

### 10.2 新增测试用例

**`issue_archive` 工具**：

- Agent `issue_archive(L2, done)` → L2.status=Done，L1 不变
- Agent `issue_archive(L1, done)` → L1.status=Done，L2 状态不变
- Agent `issue_archive(L2, canceled)` → 跳过 L2
- Agent `issue_archive(L1, canceled)` → 跳过 L1，L2 状态不变
- Agent `issue_archive(已归档 issue)` → 幂等成功
- `issue_archive` 后 `issue_list` 默认不返回该 issue

**`issue_list` 过滤**：

- L1 归档 → 整个子树不返回
- L1 活跃 + 部分 L2 归档 → 返回 L1 + 非归档 L2
- `include_archived: true` → 返回所有

**`issue_delete` 约束**：

- Active issue → 抛 `IssueNotArchivedError`
- Archived L1 → 硬删除 L1 + 其所有 L2
- Archived L2 → 硬删除 L2

**归档态保护**：

- `issue_update` Archived issue → 抛 `IssueArchivedError`
- `issue_reorder` Archived issue → 抛 `IssueArchivedError`

**Rule 1 补强**：

- `Canceled` L2 触发 Rule 1 级联（L1 自动 Done）
- `Duplicate` L2 触发 Rule 1 级联
- `In Review` 作为 active L1 状态

### 10.3 Standards 修复

- 移除 `auto-progress.ts` 中 `isActive` 方法（spec 未要求）
- 测试中 `let after` 改为两个 `const` 绑定
- 测试中 `Effect.sleep("100 millis")` 改为 `awaitWithTimeout` + 事件订阅断言

---

## 11. 迁移路径

### 11.1 代码变更范围

1. `packages/opencode/src/issue/issue.ts`：
   - 新增 `IssueArchivedError` / `IssueNotArchivedError`
   - `list` 方法新增 `include_archived` 参数
   - `update` / `reorder` 增加归档态校验
   - `delete` 增加 Active 拒绝 + L1 级联硬删 L2
   - 新增 `archive` 方法

2. `packages/opencode/src/tool/issue_archive.ts` + `issue_archive.txt`：新增工具

3. `packages/opencode/src/tool/issue_delete.ts`：增加 Active 拒绝逻辑

4. `packages/opencode/src/tool/issue_update.ts` + `issue_reorder.ts`：增加归档态拒绝

5. `packages/opencode/src/tool/issue_auto_progress.ts` + `.txt`：移除 `isActive` 暴露，更新描述

6. `packages/opencode/src/issue/auto-progress.ts`：移除 `isActive` 方法

7. `packages/app/src/pages/layout/sidebar-todo.tsx`：
   - "x"按钮按 Active / Archived 分流
   - 归档区折叠展示

8. SDK 重新生成（`./script/generate.ts`）

### 11.2 数据迁移

无 schema 变更，无数据迁移。现有 `IssueTable` 数据自然兼容新语义。

### 11.3 不做的事

- 不合并 in-session Todo 与 Todo Sidebar
- 不引入 focus 表
- 不重写 AutoProgress 引擎核心规则
- 不修改 Linear 同步的 shadow diff 机制

---

## 12. 开放问题

### 12.1 归档区 UI 默认折叠 vs 展开

当前设计为默认折叠。若用户希望快速查看历史，可改为默认展开但视觉降权。**建议默认折叠**，避免干扰活跃待办视图。

### 12.2 `issue_archive` 是否需要 `reason` 字段

当前设计无 `reason`。若未来需要 Agent 给用户的归档说明，可考虑存入 issue 的 `description` 末尾或新增 `archive_reason` 列。**当前 YAGNI**，不引入。

### 12.3 多 Agent session 并发归档同一 issue

当前 `issue_archive` 幂等，多 session 并发不会产生冲突。但若两个 session 同时归档同一 L1 的不同 L2，最后一个 L2 归档会触发 Rule 1 把 L1 标 Done，可能与另一 session 的预期不符。**当前设计接受此行为**，因为 L1 Done 是正确终态。

---

## 13. 验收标准

1. Agent 可通过 `issue_archive` 显式归档 L1 / L2，无需走 `issue_update({ status })`
2. `issue_list` 默认不返回归档 issue，L1 归档时整个子树不返回
3. `issue_delete` 拒绝 Active issue，允许 Archived issue（L1 级联硬删 L2）
4. `issue_update` / `issue_reorder` 拒绝 Archived issue
5. 用户 UI 单一"x"按钮按状态分流（Active→归档，Archived→删除）
6. AutoProgress 引擎规则不变（Rule 1 + Rule 2 + hasActive 守卫）
7. 与 Linear 同步：归档态双向同步，删除本地不影响 Linear
8. 所有测试通过（含新增 `Canceled` / `Duplicate` / `In Review` 用例）
9. `issue_auto_progress.txt` 描述明确"引擎只做级联，Agent 通过 issue_list 读取"

---

## 14. 参考资料

- ADR-0001: Todo Sidebar Scope and Surface
- ADR-0002: Sync Data Path（含 Amendments 2026-07-11 / 2026-07-12）
- ADR-0003: Migration Plan
- ADR-0004: Linear Workspace Scope
- 当前实现：`packages/opencode/src/issue/auto-progress.ts`
- Issue 服务：`packages/opencode/src/issue/issue.ts`
- Issue 工具：`packages/opencode/src/tool/issue_*.ts`
- Sidebar UI：`packages/app/src/pages/layout/sidebar-todo.tsx`
