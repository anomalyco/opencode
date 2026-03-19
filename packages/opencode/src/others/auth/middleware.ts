import type { Context, Next } from "hono"
import { Log } from "@/util/log"
import { Token } from "./token"
import type { UserInfo } from "./types"

const log = Log.create({ service: "auth.middleware" })

/**
 * 认证中间件配置
 */
export interface AuthMiddlewareConfig {
  /**
   * 不需要认证的路径 (前缀匹配)
   */
  publicPaths: string[]

  /**
   * 是否启用认证
   */
  enabled: boolean
}

/**
 * 存储在 Hono context 中的用户信息 key
 */
export const AUTH_USER_KEY = "auth:user"

/**
 * 默认公开路径
 */
const DEFAULT_PUBLIC_PATHS = [
  "/others/auth", // 登录相关接口
  "/global/health", // 健康检查
  "/doc", // API 文档
  "/event", // SSE 事件流 (需要单独处理)
]

/**
 * 检查路径是否为公开路径
 */
function isPublicPath(path: string, publicPaths: string[]): boolean {
  return publicPaths.some((publicPath) => path.startsWith(publicPath))
}

/**
 * 从请求中提取 Token
 */
function extractToken(c: Context): string | null {
  // 从 Authorization header 提取
  const authHeader = c.req.header("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }

  // 从 query 参数提取
  const tokenQuery = c.req.query("token")
  if (tokenQuery) {
    return tokenQuery
  }

  return null
}

/**
 * 创建认证中间件
 */
export function createAuthMiddleware(config: Partial<AuthMiddlewareConfig> = {}) {
  const publicPaths = config.publicPaths ?? DEFAULT_PUBLIC_PATHS
  const enabled = config.enabled ?? true

  return async (c: Context, next: Next) => {
    // 如果认证未启用，直接放行
    if (!enabled) {
      return next()
    }

    const path = c.req.path

    // OPTIONS 请求直接放行 (CORS preflight)
    if (c.req.method === "OPTIONS") {
      return next()
    }

    // 检查是否为公开路径
    if (isPublicPath(path, publicPaths)) {
      return next()
    }

    // 提取 Token
    const token = extractToken(c)
    if (!token) {
      log.warn("No token provided", { path })
      return c.json(
        {
          error: "Unauthorized",
          message: "Authentication required. Please login first.",
        },
        401,
      )
    }

    // 验证 Token
    const user = await Token.extractUser(token)
    if (!user) {
      log.warn("Invalid or expired token", { path })
      return c.json(
        {
          error: "Unauthorized",
          message: "Invalid or expired token. Please login again.",
        },
        401,
      )
    }

    // 将用户信息存储到 context 中
    c.set(AUTH_USER_KEY, user)

    log.debug("User authenticated", { username: user.username, path })

    return next()
  }
}

/**
 * 从 context 获取当前登录用户
 */
export function getCurrentUser(c: Context): UserInfo | undefined {
  return c.get(AUTH_USER_KEY)
}

/**
 * 要求用户必须登录的辅助函数
 */
export function requireAuth(c: Context): UserInfo {
  const user = getCurrentUser(c)
  if (!user) {
    throw new Error("User not authenticated. This should not happen if middleware is properly configured.")
  }
  return user
}

/**
 * 检查用户是否拥有指定权限
 */
export function hasPermission(user: UserInfo, permission: string): boolean {
  return user.permissions.includes(permission) || user.permissions.includes("admin")
}
