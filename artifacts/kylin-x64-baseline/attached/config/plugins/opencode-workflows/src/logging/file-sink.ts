/**
 * OpenCode Workflows —— File_Sink 即时落盘 Sink。
 *
 * 本文件实现 {@link createFileSink}：一个把每条 {@link LogEntry} 即时落盘到
 * `<storageRoot>/logs/workflow.log` 的 {@link LogSink}。每行写入一个独立可解析
 * 的 JSON 对象（JSON Lines），按时间线 append，每行携带 `runId`（含占位标识
 * `"unknown"`）与可选 `eventCode`/`extra`，使日志可按 run 维度追溯。
 *
 * 落盘策略（详见 design.md「Components and Interfaces」§3 File_Sink）：
 * - **位置与可追溯（R5.1 / R5.2）**：单一日志文件 + 每行带 `runId` 方案，
 *   落盘到 `<storageRoot>/logs/workflow.log`。
 * - **行格式（R5.4 / R5.8）**：每行一个 JSON 对象，至少含 `timestamp`（格式化
 *   为 ISO-8601 串）、`level`、`runId`、`message`；若 entry 带 `extra` / `eventCode`
 *   则一并写入且不丢弃任一键；行末加 `\n`。
 * - **即时落盘（R5.3）**：每次 `write` 用 `appendFileSync` 同步追加，在 `write`
 *   返回前完成落盘；单次 `appendFileSync` 对单行追加是原子的，天然满足并发行级
 *   完整性（R5.9）。
 * - **目录懒创建（R5.5）**：首次 `write` 前 `mkdirSync({ recursive: true })`
 *   幂等创建 `<storageRoot>/logs/`，置于 try 块内，失败与写盘失败同样处理。
 * - **失败容错 + 信号化（R5.6 / R5.7）**：整个写盘（含目录创建）以 try/catch
 *   包裹，失败时跳过该条、不抛，并调用 `onError(error, entry)` 信号化；`onError`
 *   自身再包一层 try/catch，避免回调抛错破坏隔离。
 * - **storageRoot 回退（R8.3）**：缺省 / 空串 / 仅空白字符 → `.opencode/workflows`。
 *
 * @see .kiro/specs/workflow-logging/design.md — Components and Interfaces §3
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 3.2, 3.4, 8.3
 */

import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import type { LogEntry, LogSink } from "./wf-logger"

/** 持久化根目录默认值（与 State_Store 共用的中立命名空间，R5.1 / R8.3）。 */
export const DEFAULT_STORAGE_ROOT = ".opencode/workflows"

/** 日志子目录名（落盘到 `<storageRoot>/logs/`，R5.1 / R5.2）。 */
const LOGS_DIR = "logs"

/** 单一日志文件名（单文件 + 每行带 runId 方案，R5.2）。 */
const LOG_FILE = "workflow.log"

/**
 * File_Sink 构造选项。
 */
export interface FileSinkOptions {
  /**
   * 落盘根目录（Storage_Root），默认 `.opencode/workflows`（R5.1 / R8.3）。
   *
   * 缺省 / 空串 / 仅含空白字符时回退默认值。
   */
  storageRoot?: string
  /**
   * 写盘失败信号化回调（R5.7）；缺省 no-op。
   *
   * 写盘（含目录创建）失败时被调用，携带触发该次失败的错误与 {@link LogEntry}，
   * 供装配层探测日志自身的健康度。该回调自身抛错不会破坏 Sink 隔离。
   */
  onError?: (error: unknown, entry: LogEntry) => void
}

/**
 * 归一 storageRoot（R8.3）。
 *
 * 缺省 / 空串 / 仅含空白字符 → 回退默认 `.opencode/workflows`；否则原样返回。
 */
function normalizeStorageRoot(input: string | undefined): string {
  if (typeof input === "string" && input.trim() !== "") {
    return input
  }
  return DEFAULT_STORAGE_ROOT
}

/**
 * 把 {@link LogEntry} 序列化为单行 JSON 文本（不含行末 `\n`）。
 *
 * `timestamp` 格式化为 ISO-8601 串（R5.4）；`level` / `runId` / `message` 必含
 * （R5.4）；`extra` / `eventCode` 仅在存在时写入，且不写入值为 undefined 的键
 * （R5.8 / R3.4）。键顺序固定为 timestamp → level → runId → message → eventCode
 * → extra，便于阅读。
 */
function serializeEntry(entry: LogEntry): string {
  const record: Record<string, unknown> = {
    timestamp: new Date(entry.timestamp).toISOString(),
    level: entry.level,
    runId: entry.runId,
    message: entry.message,
  }
  if (entry.eventCode !== undefined) {
    record.eventCode = entry.eventCode
  }
  if (entry.extra !== undefined) {
    record.extra = entry.extra
  }
  return JSON.stringify(record)
}

/**
 * 创建一个 File_Sink 即时落盘实例（R5.* / R3.2 / R3.4 / R8.3）。
 *
 * @param options 落盘配置（{@link FileSinkOptions}）。
 * @returns 满足 {@link LogSink} 契约的 Sink；其 `write` 同步落盘、永不向调用方抛出。
 */
export function createFileSink(options?: FileSinkOptions): LogSink {
  const storageRoot = normalizeStorageRoot(options?.storageRoot)
  const onError = options?.onError
  const logDir = join(storageRoot, LOGS_DIR)
  const logFile = join(logDir, LOG_FILE)

  return {
    write(entry: LogEntry): void {
      try {
        // 目录懒创建（R5.5）：幂等，置于 try 块内，失败与写盘失败同样处理。
        mkdirSync(logDir, { recursive: true })
        // 即时落盘（R5.3 / R5.9）：单次同步 append，写入返回前落盘且行级原子。
        appendFileSync(logFile, serializeEntry(entry) + "\n")
      } catch (error) {
        // 写盘（含目录创建）失败：跳过该条、不抛（R5.6），经 onError 信号化（R5.7）。
        if (onError) {
          try {
            onError(error, entry)
          } catch {
            // onError 自身抛错：吞掉，避免破坏 Sink 隔离不变量。
          }
        }
      }
    },
  }
}
