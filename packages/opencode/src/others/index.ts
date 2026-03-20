/**
 * Others 模块
 * 包含登录认证等扩展功能
 */

export * from "./auth"
export { AuthRoutes } from "./routes/auth"
export { OthersConfigService, OthersConfig, UIElementConfig } from "./config"
export { OthersConfigRoutes } from "./routes/config"
export { ProjectRoutes } from "./routes/project"
export { registerOthersRoutes, extractSpacePathFromToken } from "./server-plugin"
