/**
 * 专利操作审批策略 Hook
 *
 * 根据工具类型自动决定审批策略：
 * - 公开数据库检索 → 自动放行
 * - 分析/检查/文档操作 → 自动放行
 * - 文件写入/撰写/修改操作 → 需要审批
 */

/**
 * 创建 permission.ask 钩子
 */
export function createPermissionHandler() {
  return async (permission: any, output: any) => {
    const perm = permission.type
    const patterns = Array.isArray(permission.pattern) ? permission.pattern : [permission.pattern].filter(Boolean)

    // 公开数据库检索：自动放行
    if (perm === "patent_search" || perm === "patent_research") {
      output.status = "allow"
      return
    }

    // 分析/检查/文档操作：自动放行
    if (perm === "patent_analyze" || perm === "patent_check" || perm === "trademark" || perm === "document" || perm === "memory") {
      output.status = "allow"
      return
    }

    // 文件写入：需要审批
    if (perm === "file") {
      output.status = "ask"
      return
    }

    // 撰写/修改操作：需要审批
    if (perm.startsWith("patent_draft") || perm.startsWith("oa_response") || perm.startsWith("reexam") || perm.startsWith("invalidation")) {
      output.status = "ask"
      return
    }

    // 默认：询问
    output.status = "ask"
  }
}
