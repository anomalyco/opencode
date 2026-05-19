/** 质量检查 */
export const QUALITY_PASS_THRESHOLD = 7.5
export const QUALITY_MAX_ITERATIONS = 3

/** Agent 执行 */
export const DEFAULT_AGENT_TIMEOUT = 30000
export const SEARCH_AGENT_TIMEOUT = 60000

/** 数据库路径 */
export const PLUGIN_DATA_DIR = process.env.XDG_DATA_HOME || `${process.env.HOME || "~"}/.local/share`
export const CASE_DB_NAME = "cases.sqlite"
export const WORKFLOW_DB_NAME = "workflows.sqlite"

/**
 * 日志级别控制
 *
 * 通过 LOG_LEVEL 环境变量控制输出级别（默认 "info"）。
 * debug < info < warn < error
 */
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const
type LogLevel = keyof typeof LOG_LEVELS
const currentLogLevel: LogLevel = (Object.keys(LOG_LEVELS).includes(process.env.LOG_LEVEL ?? "")
  ? process.env.LOG_LEVEL : "info") as LogLevel

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel]
}

/** 条件日志：仅在对应级别生效时输出 */
export const log = {
  debug: (...args: unknown[]) => { if (shouldLog("debug")) console.log(...args) },
  info: (...args: unknown[]) => { if (shouldLog("info")) console.log(...args) },
  warn: (...args: unknown[]) => { if (shouldLog("warn")) console.warn(...args) },
  error: (...args: unknown[]) => { if (shouldLog("error")) console.error(...args) },
}
