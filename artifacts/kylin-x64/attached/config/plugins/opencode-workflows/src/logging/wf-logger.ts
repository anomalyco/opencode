/**
 * OpenCode Workflows —— WF_Logger 日志抽象核心类型契约。
 *
 * 本文件定义面向运行调试的日志子系统的「类型契约单一来源」：日志级别
 * （{@link LogLevel}）、级别优先级（{@link LEVEL_PRIORITY}）、单条日志记录
 * （{@link LogEntry}）、输出后端（{@link LogSink}）、日志分发器接口
 * （{@link WFLogger}）与其构造选项（{@link WFLoggerOptions}）。
 *
 * 设计取向：核心模块（Workflow_Engine / Agent_Executor / State_Store /
 * Hook_Registry）仅依赖 {@link WFLogger} 接口（`import type { WFLogger }`），
 * 不绑死任何 Sink 实现或 OpenCode SDK client，从而保持可独立单测、零侵入装配。
 *
 * 类型形状严格对应技术设计文档 design.md「Components and Interfaces」第 1 节
 * （WF_Logger 接口 + 默认实现），不得擅自增删字段。
 *
 * 注：本文件含类型/接口/常量声明、`createWFLogger` 分发器实现，以及
 * `NO_OP_LOGGER` 空实现与 `coerceLogger` 归一函数。
 *
 * @see .kiro/specs/workflow-logging/design.md — Components and Interfaces §1, §2
 * Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 3.1, 8.6
 */

// ============================================================================
// 日志级别与优先级（Log_Level）
// ============================================================================

/**
 * 日志级别。
 *
 * 与 opencode `Log.Level` 逐一对齐（R2.1），仅支持且仅支持以下四档。
 */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

/**
 * 级别优先级映射（R2.1）。
 *
 * 优先级顺序 `DEBUG`(0) < `INFO`(1) < `WARN`(2) < `ERROR`(3)，
 * 与 opencode `Log.Level` 一致，供 WF_Logger 做级别过滤比较。
 */
export const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

/**
 * 把运行时配置提供的级别字段归一为 {@link LogLevel}（R2.6 / R2.7）。
 *
 * 区别于内部的 `normalizeMinLevel`（仅接受 `WFLoggerOptions["minLevel"]`），
 * 本函数面向「运行时配置读取」场景，接受任意 `unknown` 输入：
 * - 输入精确等于 `"DEBUG"` / `"INFO"` / `"WARN"` / `"ERROR"` 四档之一时，
 *   返回对应 {@link LogLevel}（R2.6）。
 * - 输入缺失、为空串、非字符串或任意其他未知字符串时，恒返回默认 `"INFO"`
 *   （R2.7）。
 */
export function coerceLevel(input: unknown): LogLevel {
  if (typeof input === "string" && Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, input)) {
    return input as LogLevel
  }
  return "INFO"
}

// ============================================================================
// 单条日志记录（Log_Entry）
// ============================================================================

/**
 * 单条日志记录（Log_Entry，R1.* / R3.* / R4.10）。
 *
 * 由 WF_Logger 在每次日志调用时组装，并扇出给全部已注入的 {@link LogSink}。
 */
export interface LogEntry {
  /**
   * 生成时刻。设计采用 epoch ms（`number`）；File_Sink 落盘时格式化为 ISO-8601 串。
   */
  timestamp: number
  /** 日志级别。 */
  level: LogLevel
  /**
   * 运行标识。缺失 / 空串 / 非字符串时归一为占位标识 `"unknown"`（R3.5）。
   */
  runId: string
  /** 人类可读消息；可为空串。 */
  message: string
  /**
   * 结构化键值（可选）；Sink 须完整保留全部键且不丢弃任一键（R3.4）。
   */
  extra?: Record<string, unknown>
  /**
   * 关键事件分类码（可选）；Run_Background_Event 必带（R4.10）。
   */
  eventCode?: string
}

// ============================================================================
// 输出后端（Log_Sink）
// ============================================================================

/**
 * Log_Sink：WF_Logger 的输出后端（落盘文件、opencode 桥接、内存缓冲等）。
 *
 * 一个 WF_Logger 可同时写多个 Sink（R1.7）。实现内部宜自行容错（不向
 * WF_Logger 抛出更佳），但 WF_Logger 仍以 try/catch 包裹每次 `write`
 * 以满足 Sink 间相互隔离的不变量（R1.8）。
 */
export interface LogSink {
  /**
   * 写入一条 Log_Entry。
   *
   * 可为同步或异步；WF_Logger 不 await 其完成（fire-and-forget 分发），
   * 对返回的 Promise 仅挂 `.catch` 防止 unhandled rejection。
   */
  write(entry: LogEntry): void | Promise<void>
}

// ============================================================================
// 日志分发器接口（WF_Logger）
// ============================================================================

/**
 * WF_Logger 接口（核心模块仅依赖此契约，R1.2）。
 *
 * 暴露 `debug` / `info` / `warn` / `error` 四个方法（R1.1）；每个方法接收
 * 必填 `runId`（字符串）、必填 `message`（字符串）与可选 `extra`（结构化
 * 键值对象），返回 `void`，调用方无需对返回值做任何处理。
 *
 * 本接口 SHALL NOT 暴露任何返回「日志是否被禁用」状态的方法或属性——
 * 核心模块应无条件调用日志方法，不依据启用/禁用状态作分支判断（R1.6）。
 */
export interface WFLogger {
  debug(runId: string, message: string, extra?: Record<string, unknown>): void
  info(runId: string, message: string, extra?: Record<string, unknown>): void
  warn(runId: string, message: string, extra?: Record<string, unknown>): void
  error(runId: string, message: string, extra?: Record<string, unknown>): void
}

/**
 * WF_Logger 构造选项。
 */
export interface WFLoggerOptions {
  /**
   * 最小输出级别（R2.2）；缺省 `"INFO"`（R2.3）。
   *
   * 取值非 {@link LogLevel} 四档之一（含 undefined / 空 / 未知字符串）时回退
   * `"INFO"`，且该最小级别在 WF_Logger 实例生命周期内保持不变。
   */
  minLevel?: LogLevel
  /**
   * 已注入的 Sink 列表（R1.7）；可空（全部输出被静默丢弃但不抛）。
   */
  sinks?: LogSink[]
}

// ============================================================================
// WF_Logger 分发器实现（createWFLogger）
// ============================================================================

/** 默认最小输出级别（R2.3 / R2.7）。 */
const DEFAULT_MIN_LEVEL: LogLevel = "INFO"

/** runId 归一占位标识（R1.9 / R3.5）。 */
const UNKNOWN_RUN_ID = "unknown"

/**
 * 归一最小输出级别（R2.2 / R2.3 / R2.7）。
 *
 * 取值精确等于 {@link LogLevel} 四档之一时原样返回；否则（含 undefined /
 * 空串 / 未知字符串等一切不合法输入）回退默认 `"INFO"`。
 */
function normalizeMinLevel(input: WFLoggerOptions["minLevel"]): LogLevel {
  if (typeof input === "string" && Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, input)) {
    return input as LogLevel
  }
  return DEFAULT_MIN_LEVEL
}

/**
 * 归一 runId（R1.9 / R3.5）。
 *
 * 非字符串 / 空串 / 缺失 → 占位标识 `"unknown"`；合法非空字符串原样返回。
 */
function normalizeRunId(runId: unknown): string {
  if (typeof runId === "string" && runId !== "") {
    return runId
  }
  return UNKNOWN_RUN_ID
}

/**
 * 创建一个 WF_Logger 分发器实例（R1.1 / R1.6 / R1.7 / R1.8 / R1.9 /
 * R2.2 / R2.3 / R2.4 / R2.5 / R3.1 / R3.5）。
 *
 * 行为约束：
 * - **级别归一与回退**：构造时归一 `minLevel`，非四档之一（含缺失/空/未知）
 *   → 回退 `"INFO"`。该最小级别为闭包常量，实例生命周期内不可变。
 * - **runId 归一**：每次方法调用归一 `runId`（非串/空/缺失 → `"unknown"`）；
 *   `message` 缺失/空串照常生成 entry，永不抛出。
 * - **级别过滤**：`LEVEL_PRIORITY[callLevel] < LEVEL_PRIORITY[minLevel]` 时直接
 *   返回，不组装 entry、不触达任何 Sink；否则组装 entry 并扇出全部 Sink。
 * - **Sink 隔离**：对每个 Sink 独立 `try/catch`，返回的 Promise 挂
 *   `.catch(() => {})` 防止 unhandled rejection；无论多少 Sink 抛错，其余
 *   Sink 仍各自收到 entry，方法返回 `void`，永不向调用方抛出、不改控制流。
 * - **无状态查询**：不暴露任何「日志是否被禁用」的查询方法/属性（R1.6）。
 */
export function createWFLogger(options?: WFLoggerOptions): WFLogger {
  const minLevel = normalizeMinLevel(options?.minLevel)
  const minPriority = LEVEL_PRIORITY[minLevel]
  const sinks: LogSink[] = Array.isArray(options?.sinks) ? options!.sinks.slice() : []

  function emit(
    level: LogLevel,
    runId: string,
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    // 级别过滤（R2.4 / R2.5）：严格低于最小级别直接丢弃，不触达任何 Sink。
    if (LEVEL_PRIORITY[level] < minPriority) {
      return
    }

    // 组装 Log_Entry（R1.9 / R3.1 / R3.5）：runId 归一，message 空串照常。
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      runId: normalizeRunId(runId),
      message: typeof message === "string" ? message : "",
    }
    if (extra !== undefined) {
      entry.extra = extra
    }

    // 扇出全部 Sink（R1.7），每个 Sink 相互隔离（R1.8）。
    for (const sink of sinks) {
      try {
        const result = sink.write(entry)
        // 异步 Sink：挂 .catch 防止 unhandled rejection，不向调用方冒泡。
        if (result && typeof (result as Promise<void>).catch === "function") {
          ;(result as Promise<void>).catch(() => {})
        }
      } catch {
        // 同步抛错：吞掉，继续向其余 Sink 写入（永不向调用方抛出）。
      }
    }
  }

  return {
    debug(runId, message, extra) {
      emit("DEBUG", runId, message, extra)
    },
    info(runId, message, extra) {
      emit("INFO", runId, message, extra)
    },
    warn(runId, message, extra) {
      emit("WARN", runId, message, extra)
    },
    error(runId, message, extra) {
      emit("ERROR", runId, message, extra)
    },
  }
}

// ============================================================================
// No_Op_Logger 与 coerceLogger
// ============================================================================

/**
 * No_Op_Logger：WF_Logger 的空实现，所有方法不做任何输出（R1.4 / R8.6）。
 *
 * 作为核心模块（Workflow_Engine / Agent_Executor / State_Store /
 * Hook_Registry）在未注入 Logger 时的默认值，保证核心模块可独立单测且零侵入：
 * 注入 No_Op_Logger 时核心模块的业务行为（返回值、对外副作用与控制流）与注入
 * 有效 WF_Logger 时完全一致，差异仅为「无任何日志输出」。
 */
export const NO_OP_LOGGER: WFLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

/** WFLogger 接口要求具备的四个日志方法名。 */
const REQUIRED_LOGGER_METHODS = ["debug", "info", "warn", "error"] as const

/**
 * 把任意候选值归一为可用的 {@link WFLogger}（R1.5）。
 *
 * 核心模块构造时统一 `const log = coerceLogger(deps.logger)`，使核心模块始终
 * 持有一个可调用的 Logger 实例。归一规则：
 * - 候选为 `null` / `undefined` → 返回 {@link NO_OP_LOGGER}。
 * - 候选不具备 `debug` / `info` / `warn` / `error` 全部四个函数（不满足接口
 *   契约）→ 返回 {@link NO_OP_LOGGER}。
 * - 读取候选属性时抛出异常 → 返回 {@link NO_OP_LOGGER}（try/catch 兜底）。
 * - 否则原样返回候选（断言为 WFLogger）。
 */
export function coerceLogger(candidate: unknown): WFLogger {
  if (candidate === null || candidate === undefined) {
    return NO_OP_LOGGER
  }
  if (typeof candidate !== "object" && typeof candidate !== "function") {
    return NO_OP_LOGGER
  }
  try {
    for (const method of REQUIRED_LOGGER_METHODS) {
      if (typeof (candidate as Record<string, unknown>)[method] !== "function") {
        return NO_OP_LOGGER
      }
    }
  } catch {
    // 读取候选属性时抛异常（如带 throwing getter 的对象）→ 兜底回退。
    return NO_OP_LOGGER
  }
  return candidate as WFLogger
}
