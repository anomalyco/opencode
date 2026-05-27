/**
 * 专利操作审批策略 Hook
 *
 * 根据工具类型自动决定审批策略：
 * - 公开数据库检索 → 自动放行
 * - 分析/检查/文档操作 → 自动放行
 * - 文件写入/撰写/修改操作 → 需要审批
 */

import type { Permission } from "@yunpat/sdk"

/**
 * 创建 permission.ask 钩子
 */
export function createPermissionHandler() {
  return async (
    permission: Permission,
    output: { status: "ask" | "deny" | "allow" },
  ) => {
    const perm = (permission as any).type ?? (permission as any).tool ?? String(permission)
    const patterns = Array.isArray((permission as any).pattern)
      ? (permission as any).pattern
      : [(permission as any).pattern].filter(Boolean)

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
    const permStr = String(perm)
    if (permStr.startsWith("patent_draft") || permStr.startsWith("oa_response") || permStr.startsWith("reexam") || permStr.startsWith("invalidation")) {
      output.status = "ask"
      return
    }

    // 默认：询问
    output.status = "ask"
  }
}
