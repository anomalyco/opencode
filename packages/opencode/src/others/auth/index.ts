/**
 * 认证模块
 * 提供账号验证、Token 管理、认证中间件等功能
 */

export * from "./types"
export { Accounts } from "./accounts"
export { Token } from "./token"
export {
  createAuthMiddleware,
  getCurrentUser,
  requireAuth,
  hasPermission,
  AUTH_USER_KEY,
  type AuthMiddlewareConfig,
} from "./middleware"
