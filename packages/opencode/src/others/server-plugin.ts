/**
 * Others 模块 - Server 插件
 * 统一管理 Others 模块在 Server 中的路由注册和辅助功能
 */

import type { Context } from "hono"
import { Hono } from "hono"
import { AuthRoutes } from "./routes/auth"
import { OthersConfigRoutes } from "./routes/config"
import { ProjectRoutes } from "./routes/project"
import { FilesRoutes } from "./routes/files"
import { createAuthMiddleware } from "./auth/middleware"

/**
 * 注册 Others 模块的所有路由到 Hono app
 * @param app Hono 应用实例
 * @returns 注册了路由后的 app 实例
 */
export function registerOthersRoutes(app: Hono): Hono {
  return app
    .route("/others/auth", AuthRoutes())
    .route("/others/config", OthersConfigRoutes())
    .route("/others/project", ProjectRoutes())
    .route("/others/files", FilesRoutes())
    .use(createAuthMiddleware())
}

/**
 * 从 Token 中提取用户的 space_path
 * 用于作为默认的 directory/home
 * @param c Hono Context
 * @returns space_path 或 undefined
 */
export async function extractSpacePathFromToken(c: Context): Promise<string | undefined> {
  // 导入延迟到函数内部，避免循环依赖
  const { Token } = await import("./auth/token")

  const authHeader = c.req.header("Authorization")
  if (!authHeader?.startsWith("Bearer ")) return undefined

  const token = authHeader.slice(7)
  const user = await Token.extractUser(token)
  return user?.space_path
}
