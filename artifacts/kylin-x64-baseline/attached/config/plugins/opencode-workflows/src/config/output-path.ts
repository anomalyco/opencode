/**
 * OpenCode Workflows —— output_path 占位符替换与路径安全化（框架层纯函数）。
 *
 * 本模块把 {@link ResolvedConfigBlock} 的 `outputPath` 模板（含 `<RUNID>` /
 * `<FEATURE>` 占位符）替换为运行期的最终绝对路径，由 **WorkflowEngine 在启动 run 时**
 * 调用（此时 runId 与 label 均已就绪）。替换后的最终路径注入 `ctx.config.outputPath`，
 * 因此脚本拿到的 `ctx.config.outputPath` 已是最终绝对路径，无需自己再替换占位符。
 *
 * 两个占位符（对齐既有「label/runId 区分同名 run」优化）：
 * - `<RUNID>`   → {@link shortRunId}（8 位短前缀，绝对唯一、安全无非法字符）；
 * - `<FEATURE>` → {@link deriveRunLabel} 提取的可读短标签（可能重名）；label 为空或
 *                 提取为 `undefined` 时回退到短 runId，保证目录名始终有效。
 *
 * 两个替换值都经 {@link sanitizeSegment} 安全化为单个路径段（无路径分隔符 / `..` /
 * 文件名非法字符），避免污染落盘路径。复用 `monitor-data` 既有的 `shortRunId` /
 * `deriveRunLabel`，不重写提取逻辑。
 *
 * 依赖：仅用 Node 内置 `node:path`（`isAbsolute/normalize/resolve`）做跨平台路径
 * 解析；全程无副作用、不访问文件系统、不创建目录。
 *
 * @see .kiro/specs/workflow-enhancements/design.md — 算法 3：output_path 占位符替换
 * Requirements: 6.1, 6.2, 6.3
 */

import { isAbsolute, normalize, resolve } from "node:path"

import { deriveRunLabel, shortRunId } from "../tui/monitor-data"

// ============================================================================
// 路径段安全化
// ============================================================================

/**
 * 当替换值安全化后为空时回退使用的固定非空路径段。
 *
 * 保证替换进 output_path 的目录段恒为合法非空段（不会产生 `//`、空段等）。
 */
export const FALLBACK_SEGMENT = "run"

/**
 * 把字符串安全化为**单个路径段**：去掉路径分隔符与 `..` 等，避免污染落盘路径。
 *
 * 替换规则（依次应用）：
 * - 路径分隔符 `/`、`\`（含连续多个）→ `_`；
 * - 连续点序列 `..`（两个及以上的 `.`）→ `_`（防止 `..` 目录穿越）；
 * - 文件名非法字符 `:`、`*`、`?`、`"`、`<`、`>`、`|` → `_`；
 * - 首尾空白去除（`trim`）。
 *
 * 安全化结果为空时回退到 {@link FALLBACK_SEGMENT}，保证返回值恒为非空单路径段
 * （不含路径分隔符与 `..`）。本函数为**纯函数、无副作用**。
 *
 * @param s 待安全化的原始字符串（如标签或短 runId）。
 * @returns 单个非空路径段（无路径分隔符 / `..` / 文件名非法字符）。
 *
 * @see .kiro/specs/workflow-enhancements/design.md — 算法 3：output_path 占位符替换
 * Requirements: 6.2
 */
export function sanitizeSegment(s: string): string {
  return (
    s
      .replace(/[\\/]+/g, "_")
      .replace(/\.\.+/g, "_")
      .replace(/[:*?"<>|]/g, "_")
      .trim() || FALLBACK_SEGMENT
  )
}

// ============================================================================
// output_path 占位符替换与绝对化
// ============================================================================

/**
 * 把 output_path 模板中的占位符替换为运行期值，并绝对化为最终落盘路径。
 *
 * 行为（对齐 design.md「算法 3」与 Requirement 6.1/6.2/6.3）：
 * - `template === null` → 返回 `null`（不执行任何替换，调用方据此把 `outputPath` 置 `null`）；
 * - 否则：将模板内所有 `<RUNID>` 替换为 `shortRunId(runId)`（8 位短 runId），
 *   将所有 `<FEATURE>` 替换为 `deriveRunLabel(label)` 提取的安全标签（label 为空或
 *   `deriveRunLabel` 返回 `undefined` 时回退为短 runId）；两个替换值均经
 *   {@link sanitizeSegment} 安全化为单路径段；
 * - 结果经 `isAbsolute ? normalize : resolve(projectRoot, ...)` 绝对化为不含任何
 *   未替换 `<RUNID>` / `<FEATURE>` 子串的规范化绝对路径。
 *
 * 无占位符的模板按原样绝对化（幂等）。本函数为**纯函数、无副作用、不访问文件系统**。
 *
 * @param template output_path 模板（含 0..n 个 `<RUNID>` / `<FEATURE>`）或 `null`。
 * @param runId 当前 Run 的 runId（非空安全字符串，State_Store 生成）。
 * @param label 当前 Run 的需求原文标签（来自 `args.feature`），可空/可缺省。
 * @param projectRoot 相对路径绝对化的基准目录。
 * @returns 最终落盘绝对路径，或 `template === null` 时返回 `null`。
 *
 * @see .kiro/specs/workflow-enhancements/design.md — 算法 3 / 函数 4：resolveOutputPath
 * Requirements: 6.1, 6.2, 6.3
 */
export function resolveOutputPath(
  template: string | null,
  runId: string,
  label: string | undefined,
  projectRoot: string,
): string | null {
  // R6.3：模板为 null → 不替换，直接返回 null。
  if (template === null) return null
  // <RUNID>：复用 monitor-data.shortRunId（8 位短前缀），并安全化为单路径段。
  const short = sanitizeSegment(shortRunId(runId))
  // <FEATURE>：复用 monitor-data.deriveRunLabel；空/不可提取时回退到短 runId。
  const feat = sanitizeSegment(deriveRunLabel(label) ?? short)
  const replaced = template.split("<RUNID>").join(short).split("<FEATURE>").join(feat)
  // 绝对化：相对路径以 projectRoot 为基准 resolve，绝对路径仅 normalize（不被 root 改写）。
  return isAbsolute(replaced) ? normalize(replaced) : resolve(projectRoot, replaced)
}
