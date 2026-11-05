/**
 * OpenCode Workflows —— WF 日志 / 可观测性：OpenCode_Bridge_Sink（桥接 Sink）。
 *
 * 本 Sink 把 WF_Logger 分发的每条 {@link LogEntry} 经
 * `client.app.log({ body: { service, level, message } })`（POST `/log`）转发进
 * opencode 的统一日志文件，使排查 opencode 整体行为时可一并看到 workflow 的日志。
 *
 * 设计取向（与 design.md「Components and Interfaces」第 4 节逐一对齐）：
 * - 仅声明本 Sink 实际使用的 `app.log` 能力（{@link OpenCodeLogClientPort}），解耦真实
 *   SDK client、便于 Mock 与单测（R8.7）。
 * - 固定 `service` 值 `"workflow"`（可经 options 覆盖），使 workflow 日志在 opencode
 *   日志中可凭 `service` 区分（R6.2）。
 * - 级别映射：`DEBUG→"debug"` / `INFO→"info"` / `WARN→"warn"` / `ERROR→"error"`（R6.3）。
 * - `app.log` 的 body 仅有 `service`/`level`/`message` 三字段，故把 `runId`、`eventCode`
 *   与 `extra` 的全部键值编码进 `message` 文本（R3.3 / R3.4 / R6.7）。
 * - 失败容错：`app.log` 同步抛错 / 返回 reject / 错误状态 → 捕获并丢弃该条桥接输出，
 *   不抛、不影响其余 Sink，WF_Logger 不向业务调用方抛出（R6.6）。
 *
 * 注入边界（R6.4 / R6.5）：本 Sink 仅在持有 SDK client 的最外层入口（`index.ts` /
 * `tui.tsx`）被注入；核心模块（engine / executor / store）不得直接构造本 Sink。
 *
 * @see .kiro/specs/workflow-logging/design.md — Components and Interfaces §4
 * Requirements: 6.1, 6.2, 6.3, 6.6, 6.7, 3.3, 3.4
 */

import type { LogEntry, LogLevel, LogSink } from "./wf-logger"

// ============================================================================
// 端口（Port）与构造选项
// ============================================================================

/**
 * OpenCode 日志 client 端口（仅声明本 Sink 实际使用的 `app.log` 能力）。
 *
 * 通过窄化端口而非依赖完整 SDK client，使本 Sink 与真实 SDK 解耦：核心层单测可注入
 * 满足本端口的轻量 Mock 捕获调用 / 注入抛错（R8.7）。`level` 取小写四档，与 opencode
 * `client.app.log` 接受的取值一致。
 */
export interface OpenCodeLogClientPort {
  app: {
    log(options: {
      body: { service: string; level: "debug" | "info" | "warn" | "error"; message: string }
    }): Promise<unknown>
  }
}

/**
 * OpenCode_Bridge_Sink 构造选项。
 */
export interface BridgeSinkOptions {
  /**
   * 固定 `service` 值，默认 `"workflow"`（R6.2）。
   *
   * 仅当显式提供时覆盖默认值；缺省（`undefined`）时取 `"workflow"`。
   */
  service?: string
}

// ============================================================================
// 级别映射与 message 编码
// ============================================================================

/**
 * WF_Logger 级别 → `app.log` 小写 level 的一一映射（R6.3）。
 */
const LEVEL_MAP: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
}

/**
 * 把 {@link LogEntry} 的 `runId`、`eventCode` 与 `extra` 编码进单行 `message` 文本（R6.7）。
 *
 * 格式：`[runId=<runId>]` 接可选 ` [<eventCode>]`，接 ` <message>`，若 `extra` 非空再接
 * ` <JSON(extra)>`。例如：
 * `[runId=ab12] [AGENT_TIMEOUT] agent 超时 abort {"agentIndex":3,"timeoutMs":300000}`。
 *
 * 保证转发后的日志行可凭 `runId` 检索（R3.3），且 `extra` 的全部键值完整保留、不丢任一键
 * （R3.4 / R6.7）。`extra` 序列化以 try/catch 兜底，避免不可序列化值（如循环引用）破坏整条转发。
 */
function encodeMessage(entry: LogEntry): string {
  const parts: string[] = [`[runId=${entry.runId}]`]
  if (entry.eventCode !== undefined && entry.eventCode !== "") {
    parts.push(`[${entry.eventCode}]`)
  }
  parts.push(typeof entry.message === "string" ? entry.message : "")
  if (entry.extra !== undefined && entry.extra !== null && Object.keys(entry.extra).length > 0) {
    try {
      parts.push(JSON.stringify(entry.extra))
    } catch {
      // 不可序列化的 extra（如循环引用）：退化为 String() 表示，不丢整条转发。
      parts.push(String(entry.extra))
    }
  }
  return parts.join(" ")
}

// ============================================================================
// createOpenCodeBridgeSink
// ============================================================================

/**
 * 创建一个 OpenCode_Bridge_Sink（R6.1 / R6.2 / R6.3 / R6.6 / R6.7 / R3.3 / R3.4）。
 *
 * 每次 `write(entry)`：
 * - 经 `client.app.log({ body: { service, level, message } })` 转发该条日志（R6.1）。
 * - `service` 固定为 `options.service ?? "workflow"`（R6.2）。
 * - `level` 按 {@link LEVEL_MAP} 大小写映射（R6.3）。
 * - `message` 由 {@link encodeMessage} 编码，含可检索的 `runId` 与不丢键的 `extra`（R6.7）。
 *
 * 失败容错（R6.6）：`client.app.log` 同步抛异常 / 返回 rejected Promise / 以错误状态返回
 * → try/catch 捕获、对返回的 Promise 挂 `.catch(() => {})` 丢弃该条桥接输出，永不向上抛出、
 * 不影响其余 Sink（其余 Sink 仍各自收到该条 Log_Entry）。
 *
 * @param client 满足 {@link OpenCodeLogClientPort} 的 client（真实 SDK client 适配或 Mock）。
 * @param options 可选构造选项（如覆盖 `service`）。
 */
export function createOpenCodeBridgeSink(
  client: OpenCodeLogClientPort,
  options?: BridgeSinkOptions,
): LogSink {
  const service = options?.service ?? "workflow"

  return {
    write(entry: LogEntry): void {
      try {
        const result = client.app.log({
          body: {
            service,
            level: LEVEL_MAP[entry.level],
            message: encodeMessage(entry),
          },
        })
        // 异步 reject / 错误状态：挂 .catch 丢弃，防止 unhandled rejection，不向上冒泡。
        if (result && typeof (result as Promise<unknown>).catch === "function") {
          ;(result as Promise<unknown>).catch(() => {})
        }
      } catch {
        // app.log 同步抛错：吞掉该条桥接输出，不抛、不影响其余 Sink。
      }
    },
  }
}
