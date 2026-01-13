/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/console/app/src/routes/auth
 * ============================================================================
 *
 * 文件作用：
 * 认证入口路由。处理用户访问 /auth 时的重定向逻辑。
 *
 * 主要功能：
 * - 尝试获取用户上次访问的工作区
 * - 如果有工作区记录，重定向到该工作区页面
 * - 如果没有工作区记录，重定向到授权页面
 *
 * 依赖关系：
 * - @solidjs/router：重定向函数
 * - @solidjs/start/server：API 事件类型
 * - ../workspace/common：获取上次访问工作区工具函数
 *
 * 导出内容：
 * - GET：处理 GET 请求，执行重定向逻辑
 *
 * 路由：
 * - GET /auth → 重定向到工作区或授权页面
 *
 * @package console.app
 * @module auth/routes
 */

// 导入重定向函数
import { redirect } from "@solidjs/router"

// 导入 API 事件类型
import type { APIEvent } from "@solidjs/start/server"

// 导入获取上次访问工作区的工具函数
import { getLastSeenWorkspaceID } from "../workspace/common"

/**
 * 认证入口路由处理器
 *
 * 当用户访问 /auth 路径时：
 * 1. 尝试从 cookie 中获取上次访问的工作区 ID
 * 2. 如果获取成功，重定向到该工作区页面
 * 3. 如果获取失败（没有工作区记录），重定向到授权页面引导用户登录
 *
 * @param input - API 事件对象
 * @returns 重定向响应
 *
 * @example
 * 用户访问 /auth：
 * - 有工作区记录 → 重定向到 /workspace/wrk_xxx
 * - 无工作区记录 → 重定向到 /auth/authorize
 */
export async function GET(input: APIEvent) {
  try {
    // 尝试获取上次访问的工作区 ID
    const workspaceID = await getLastSeenWorkspaceID()
    // 成功获取，重定向到工作区页面
    return redirect(`/workspace/${workspaceID}`)
  } catch {
    // 获取失败，重定向到授权页面
    return redirect("/auth/authorize")
  }
}
