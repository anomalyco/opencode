/**
 * 权限询问钩子
 * 简单透传：Permission 类型无 sessionID 字段，无法获取 per-session 路由决策。
 * 实际权限逻辑由专利插件的 permission handler 处理。
 */

import type { RouterContext } from "../types/index.js"
import type { Permission } from "@yunpat/sdk"

export function createPermissionHandler(context: RouterContext) {
  return async (
    input: Permission,
    output: { status: "ask" | "deny" | "allow" },
  ) => {
    // Permission 类型不包含 sessionID，无法关联路由决策。
    // 保持简单透传，不修改 output.status。
    console.debug(`[Permission] 权限询问透传: status=${output.status}`)
  }
}
