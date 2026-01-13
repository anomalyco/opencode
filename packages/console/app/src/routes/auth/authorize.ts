/**
 * ============================================================================
 * 文件名：authorize.ts
 * 所属包：packages/console/app/src/routes/auth
 * ============================================================================
 *
 * 文件作用：
 * OAuth 授权初始化路由。启动 OAuth 授权流程，将用户重定向到身份提供商。
 *
 * 主要功能：
 * - 调用 OpenAuth 客户端初始化授权流程
 * - 生成授权 URL 并将用户重定向到身份提供商的登录页面
 * - 使用 code 授权模式（更安全）
 *
 * 依赖关系：
 * - @solidjs/start/server：API 事件类型
 * - ~/context/auth：OpenAuth 客户端
 *
 * 导出内容：
 * - GET：处理 GET 请求，启动 OAuth 授权流程
 *
 * 路由：
 * - GET /auth/authorize → 重定向到身份提供商（如 GitHub）
 *
 * OAuth 流程：
 * 1. 用户访问 /auth/authorize
 * 2. 后端生成授权 URL
 * 3. 用户被重定向到身份提供商
 * 4. 用户登录并授权
 * 5. 提供商将用户重定向回 /auth/callback（附带授权码）
 *
 * @package console.app
 * @module auth/routes
 */

// 导入 API 事件类型
import type { APIEvent } from "@solidjs/start/server"

// 导入 OpenAuth 客户端
import { AuthClient } from "~/context/auth"

/**
 * OAuth 授权初始化路由处理器
 *
 * 启动 OAuth 2.0 授权流程：
 * 1. 使用 OpenAuth 客户端生成授权 URL
 * 2. 设置回调地址为 ./callback（相对于当前 URL）
 * 3. 使用 code 授权模式（PKCE 流程的一部分）
 * 4. 将用户重定向到身份提供商
 *
 * @param input - API 事件对象
 * @returns 302 重定向响应到身份提供商
 *
 * @example
 * 用户访问 /auth/authorize：
 * - 生成 GitHub 授权 URL：https://github.com/login/oauth/authorize?...
 * - 重定向用户到 GitHub 登录页面
 */
export async function GET(input: APIEvent) {
  // 调用 OpenAuth 客户端生成授权 URL
  const result = await AuthClient.authorize(
    // 回调 URL：相对于当前请求 URL 的 ./callback 路径
    new URL("./callback", input.request.url).toString(),
    // 授权模式：code（授权码模式，比 token 模式更安全）
    "code",
  )
  // 返回 302 重定向响应，将用户引导到身份提供商的登录页面
  return Response.redirect(result.url, 302)
}
