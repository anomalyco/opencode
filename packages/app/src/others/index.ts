/**
 * Others 模块前端导出
 * 包含登录认证、配置管理等扩展功能的组件和上下文
 */

// 认证相关
export { useAuth, AuthProvider } from "./context/auth"

// 配置相关
export { useOthersConfig, OthersConfigProvider } from "./context/others-config"

// 页面
export { LoginPage } from "./pages/login"

// 组件
export { UserMenu } from "./components/user-menu"
export { FileManagerButton } from "./components/file-manager-button"
export { CreateProjectButton } from "./create-project-button"
export { DialogCreateProject } from "@/components/dialog-create-project"
