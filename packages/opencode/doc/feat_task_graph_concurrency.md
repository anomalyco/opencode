# 任务调度优化：从循环阻塞到层级并发

## 概述

本文档描述了将 SessionPrompt.loop 中的子任务处理从串行阻塞模式改为层级并发模式的实现。

## 问题分析

### 原有实现的问题

在 `SessionPrompt.loop` 中，子任务（subtask）的处理采用串行阻塞模式：

```typescript
while (true) {
  // ...
  const task = tasks.pop()

  if (task?.type === "subtask") {
    // 逐个执行子任务
    await executeSubtask(task)
    continue // 回到循环开始，处理下一个任务
  }
}
```

**主要问题：**

1. **资源利用率低**：即使多个子任务之间没有依赖关系，也必须等待前一个完成后才能开始下一个
2. **执行时间长**：对于相互独立的子任务，原本可以并行执行，现在只能串行
3. **无法利用现代多核CPU**：无法充分利用系统并行处理能力

## 解决方案

### TaskGraph 概念

引入 `TaskGraph` 来表示子任务之间的依赖关系：

```typescript
interface TaskNode {
  id: string
  task: MessageV2.SubtaskPart
  dependencies: Set<string> // 依赖的其他任务ID
  dependents: Set<string> // 依赖于当前任务的其他任务ID
  level: number // 在执行层级中的层级
}
```

### 层级并发调度

1. **依赖分析**：分析子任务之间的依赖关系
2. **层级划分**：将任务划分为多个层级（Level）
3. **层级执行**：同一层级的任务可以并行执行，只有当上一层级的所有任务完成后才开始下一层级

## 实现架构

### 新增文件

#### `work-queue/graph.ts`

**主要类：TaskGraph**

```typescript
export class TaskGraph {
  constructor(tasks: MessageV2.SubtaskPart[])

  // 构建任务图
  private buildGraph(): void

  // 分析任务依赖
  private analyzeDependencies(): void

  // 计算任务层级
  private calculateLevels(): void

  // 构建层级结构
  buildLevels(): TaskGraphResult
}
```

**主要函数：executeTaskLevels**

```typescript
export async function executeTaskLevels(
  levels: TaskLevel[],
  executeSubtask: (task: MessageV2.SubtaskPart) => Promise<void>,
  maxParallel?: number,
): Promise<void>
```

### 修改的文件

#### `session/prompt.ts`

**修改前：**

```typescript
if (task?.type === "subtask") {
  await executeSingleSubtask(task, ...)
  continue
}
```

**修改后：**

```typescript
if (task?.type === "subtask") {
  const subtaskQueue = tasks.filter((t): t is MessageV2.SubtaskPart => t.type === "subtask")
  subtaskQueue.unshift(task)

  const graph = new TaskGraph(subtaskQueue)
  const graphResult = graph.buildLevels()

  if (graphResult.totalNodes > 1 && graphResult.levels.length > 0) {
    const executeSubtaskFn = async (subtask: MessageV2.SubtaskPart): Promise<void> => {
      await executeSingleSubtask(subtask, ...)
    }

    await executeTaskLevels(graphResult.levels, executeSubtaskFn, 5)
    tasks = tasks.filter((t) => t.type !== "subtask")
    continue
  } else {
    await executeSingleSubtask(task, ...)
    continue
  }
}
```

### 依赖分析策略

TaskGraph 使用多种策略来识别任务之间的依赖关系：

1. **关键词检测**：
   - "after", "once", "when", "following", "based on", "using results from"
   - 模式匹配：`${triggerWord} ${agentName}`

2. **内容相似性检测**：
   - 如果一个任务的提示词包含另一个任务提示词的前30个字符，认为存在依赖

3. **双向依赖检测**：
   - 检测任务A是否依赖任务B
   - 同时检测任务B是否依赖任务A

### 执行流程

```
1. 收集所有待处理的子任务
   ↓
2. 构建 TaskGraph
   ├─ 识别每个任务的唯一ID
   ├─ 分析依赖关系
   └─ 计算执行层级
   ↓
3. 判断是否需要并发
   ├─ 单一任务 → 串行执行
   └─ 多个任务 → 并发执行
   ↓
4. 执行层级任务
   ├─ Level 0: 无依赖的任务 → 并行执行
   ├─ Level 1: 依赖 Level 0 的任务 → 等 Level 0 完成后再执行
   └─ ...
   ↓
5. 清理并继续主循环
```

### 性能提升预估

**场景分析：**

| 场景                    | 原有模式 | 新模式     | 提升    |
| ----------------------- | -------- | ---------- | ------- |
| 3个独立任务             | 3×T      | 1×T (并行) | ~3x     |
| 2个独立 + 1个依赖前两个 | 3×T      | 2×T        | ~1.5x   |
| 5个任务形成依赖链       | 5×T      | 5×T        | 无提升  |
| 混合场景                | 变化     | 优化       | ~1.5-2x |

## 集成到 SessionProcessor

### 并发控制

- **最大并发数**：默认 5 个任务（可配置）
- **使用 Promise.all**：并行执行同一层级的任务
- **错误处理**：单个任务失败不影响其他任务

### 依赖关系图示例

```
任务A (explore:API设计)
  ↓ 依赖
任务B (build:实现API)
  ↓ 依赖
任务C (test:测试API)

任务D (explore:数据库结构) ─── 无依赖 ───→ Level 0
任务E (explore:前端代码)    ─── 无依赖 ───→ Level 0
                                         ↓
任务F (build:后端逻辑) ─── 依赖D,E ───→ Level 1
                                         ↓
任务G (build:前端集成) ─── 依赖E ──────→ Level 2
```

## 配置选项

可通过配置文件调整并发行为：

```typescript
interface TaskGraphConfig {
  maxParallel?: number // 最大并发数，默认 5
  analyzeDependencies?: boolean // 是否分析依赖，默认 true
}
```

## 测试策略

### 单元测试

1. **TaskGraph 构建测试**
   - 单一任务
   - 无依赖的多个任务
   - 存在依赖的任务链
   - 循环依赖检测

2. **层级划分测试**
   - 正确划分层级
   - 边界情况处理

### 集成测试

1. **实际任务执行测试**
   - 并发执行多个任务
   - 验证执行顺序正确
   - 验证依赖关系被正确处理

2. **性能测试**
   - 测量执行时间
   - 对比串行和并发模式

## 未来优化方向

1. **智能依赖分析**
   - 使用 LLM 更准确地识别任务依赖
   - 考虑任务输出的实际使用情况

2. **动态层级调整**
   - 根据运行时信息调整层级
   - 支持任务的动态添加和移除

3. **资源感知调度**
   - 根据系统负载动态调整并发数
   - 考虑任务对资源的不同需求

4. **分布式支持**
   - 扩展到多节点执行
   - 支持跨会话的任务共享

## 总结

通过引入 TaskGraph 和层级并发调度，我们实现了：

✅ **性能提升**：独立任务并行执行，减少总执行时间
✅ **资源优化**：更好地利用系统并行处理能力  
✅ **向后兼容**：保持原有行为，仅在有收益时启用并发
✅ **可配置性**：支持自定义并发数和依赖分析策略
✅ **可扩展性**：易于添加新的调度策略和优化
