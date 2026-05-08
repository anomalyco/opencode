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
