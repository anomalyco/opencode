/**
 * OpenCode Workflows —— Memory_Sink 内存环形缓冲 Sink。
 *
 * 本文件实现一个把日志保留在内存环形缓冲（ring buffer）的 {@link LogSink}
 * 实现（{@link createMemorySink}），主要供 TUI 诊断与测试断言读取最近的若干
 * 条 {@link LogEntry}。
 *
 * 设计取向：Memory_Sink 为**可选** Sink，**不**取代 State_Store 的
 * `getMemoryLog()` 与 Hook_Registry 的 `getLog()`——后两者的「收编」采用双写
 * 策略，保留各自原内存快照不变，同时经注入的 WF_Logger 输出。
 *
 * 环形缓冲约束：容量上限 `capacity`（默认 1000，防止内存无界增长）。当写入
 * 条数超过容量时，最旧的条目被丢弃（环形覆盖）。`getEntries()` 返回按时间线
 * （oldest → newest）排列的只读快照，`clear()` 清空缓冲。
 *
 * @see .kiro/specs/workflow-logging/design.md — Components and Interfaces §5
 * Requirements: 1.7
 */

import type { LogEntry, LogSink } from "./wf-logger"

// ============================================================================
// 类型契约
// ============================================================================

/**
 * Memory_Sink 构造选项。
 */
export interface MemorySinkOptions {
  /**
   * 环形缓冲容量上限，默认 1000（防止内存无界增长）。
   *
   * 取值非法（`<= 0`、非整数、`NaN`、非数字、缺失）时回退默认 1000。
   */
  capacity?: number
}

/**
 * Memory_Sink：把日志保留在内存环形缓冲的 {@link LogSink}。
 *
 * 在 {@link LogSink} 之上额外暴露只读快照读取与清空能力，供 TUI 诊断与测试断言。
 */
export interface MemorySink extends LogSink {
  /**
   * 返回内存缓冲的只读快照（供 TUI 诊断）。
   *
   * 快照按时间线排列（最旧 → 最新），且与内部缓冲解耦——后续写入不影响已返回
   * 的快照数组。
   */
  getEntries(): readonly LogEntry[]
  /** 清空内存缓冲。 */
  clear(): void
}

// ============================================================================
// 实现（createMemorySink）
// ============================================================================

/** 默认环形缓冲容量上限。 */
const DEFAULT_CAPACITY = 1000

/**
 * 归一容量上限。
 *
 * 取值为正整数时原样返回；否则（`<= 0`、非整数、`NaN`、非数字、缺失）回退
 * 默认 {@link DEFAULT_CAPACITY}。
 */
function normalizeCapacity(input: MemorySinkOptions["capacity"]): number {
  if (typeof input === "number" && Number.isInteger(input) && input > 0) {
    return input
  }
  return DEFAULT_CAPACITY
}

/**
 * 创建一个 Memory_Sink 环形缓冲 Sink 实例（R1.7）。
 *
 * 行为约束：
 * - **容量归一**：构造时归一 `capacity`，非正整数（含缺失/`<=0`/非整数/`NaN`/
 *   非数字）→ 回退默认 1000。容量为闭包常量，实例生命周期内不可变。
 * - **环形覆盖**：写入条数未超过容量时按序追加；超过容量后，最旧条目被覆盖
 *   （ring overwrite），缓冲始终只保留最近 `capacity` 条。
 * - **只读快照**：`getEntries()` 返回按时间线（最旧 → 最新）排列的全新数组，
 *   与内部缓冲解耦——后续写入不改变已返回的快照。
 * - **清空**：`clear()` 重置缓冲为空并释放对已缓存条目的引用（便于 GC）。
 */
export function createMemorySink(options?: MemorySinkOptions): MemorySink {
  const capacity = normalizeCapacity(options?.capacity)
  // 定长底层数组实现环形缓冲：`start` 指向最旧条目，`size` 为有效条目数。
  const buffer: (LogEntry | undefined)[] = new Array(capacity)
  let start = 0
  let size = 0

  function write(entry: LogEntry): void {
    const writeIndex = (start + size) % capacity
    buffer[writeIndex] = entry
    if (size < capacity) {
      size += 1
    } else {
      // 缓冲已满：覆盖最旧条目，`start` 前移一位（环形）。
      start = (start + 1) % capacity
    }
  }

  function getEntries(): readonly LogEntry[] {
    const result: LogEntry[] = new Array(size)
    for (let i = 0; i < size; i += 1) {
      // 非空断言安全：`[start, start + size)` 范围内的槽位均已写入有效条目。
      result[i] = buffer[(start + i) % capacity] as LogEntry
    }
    return result
  }

  function clear(): void {
    start = 0
    size = 0
    // 释放对已缓存条目的引用，便于垃圾回收。
    buffer.fill(undefined)
  }

  return { write, getEntries, clear }
}
