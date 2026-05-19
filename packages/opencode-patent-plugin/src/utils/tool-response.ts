/**
 * 统一的工具响应格式化
 */

/** 格式化错误响应 */
export function toolError(message: string, code?: string): string {
  return JSON.stringify({ error: true, code: code || "TOOL_ERROR", message }, null, 2)
}

/** 格式化参数缺失错误 */
export function toolMissingParam(param: string, description: string): string {
  return toolError(`缺少必需参数: ${param} — ${description}`, "MISSING_PARAMETER")
}
