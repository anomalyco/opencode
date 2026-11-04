/**
 * OpenCode Workflows —— RunId 生成器与文件名派生辅助。
 *
 * 设计要点（见 design.md「State_Store」与「runId 与文件名约定」）：
 * - `runId` 本身**不含** `wf_` 前缀，是一个前缀无关的唯一标识符。
 * - `wf_` 前缀**仅用于文件名**（如 `runs/wf_<runId>.json`、
 *   `scripts/<name>-wf_<runId>.mjs`）。
 * - runId **必须**使用加密随机来源（`crypto.randomUUID()`），
 *   **禁止使用时间戳**作为唯一性来源——R3.6/R13 允许并发启动多个
 *   Workflow，时间戳在同毫秒并发下会碰撞；加密随机满足 Property 2
 *   要求的「并发 1000 次生成 runId 互不相同」不变量。
 *
 * @see .kiro/specs/opencode-workflows/design.md — State_Store / runId 与文件名约定
 * Requirements: 3.1, 7.1
 */

/** 文件名中使用的 runId 前缀；runId 本身不含此前缀，仅用于派生文件名。 */
export const RUN_FILE_PREFIX = "wf_"

/**
 * 生成不含 `wf_` 前缀的唯一 runId。
 *
 * 使用 Bun/Node 全局可用的 `crypto.randomUUID()`（加密随机），
 * 而非时间戳——保证在同一项目内、乃至同毫秒并发启动时互不重复（R3.1、R7.1）。
 *
 * @returns 形如 `"1f7b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d"` 的非空唯一标识符（不含 `wf_` 前缀）。
 *
 * @example
 * ```ts
 * const runId = generateRunId()
 * // runId 不含 "wf_" 前缀，可直接作为 Journal 目录名等使用
 * ```
 */
export function generateRunId(): string {
  return crypto.randomUUID()
}

/**
 * 从 runId 派生 Run/文件名基名（file base / stem）：`wf_<runId>`。
 *
 * 该基名用于拼接 Run Snapshot 文件名（`runs/<base>.json`）等所有需要
 * `wf_` 前缀的场景。runId 本身不含前缀，前缀仅在此处统一附加。
 *
 * @param runId 由 {@link generateRunId} 生成的、不含 `wf_` 前缀的 runId。
 * @returns 形如 `"wf_<runId>"` 的文件名基名。
 *
 * @example
 * ```ts
 * toRunFileBase("abc-123") // => "wf_abc-123"
 * // Run Snapshot 路径：runs/${toRunFileBase(runId)}.json
 * ```
 */
export function toRunFileBase(runId: string): string {
  return `${RUN_FILE_PREFIX}${runId}`
}

/**
 * 从 workflow name 与 runId 派生脚本归档文件基名：`<name>-wf_<runId>`。
 *
 * 用于脚本归档路径 `scripts/<name>-wf_<runId>.mjs`（R7.2、R7.4）。
 *
 * @param name 已校验的 workflow 名称（来自 meta.name）。
 * @param runId 由 {@link generateRunId} 生成的、不含 `wf_` 前缀的 runId。
 * @returns 形如 `"<name>-wf_<runId>"` 的脚本归档基名。
 *
 * @example
 * ```ts
 * toScriptFileBase("lingxi-harness", "abc-123")
 * // => "lingxi-harness-wf_abc-123"
 * // 脚本归档路径：scripts/${toScriptFileBase(name, runId)}.mjs
 * ```
 */
export function toScriptFileBase(name: string, runId: string): string {
  return `${name}-${toRunFileBase(runId)}`
}
