/**
 * ============================================================================
 * 文件名：callback.ts
 * 所属包：packages/console/app/src/routes/auth
 * ============================================================================
 *
 * 文件作用：
 * OAuth 回调路由。处理身份提供商返回的授权码，完成用户认证流程。
 *
 * 主要功能：
 * - 接收身份提供商返回的授权码
 * - 使用授权码交换访问令牌
 * - 解码访问令牌获取用户信息
 * - 更新会话存储用户账户信息
 * - 重定向到认证入口
 *
 * 依赖关系：
 * - @solidjs/router：重定向函数
 * - @solidjs/start/server：API 事件类型
 * - ~/context/auth：OpenAuth 客户端和会话管理
 *
 * 导出内容：
 * - GET：处理 GET 请求，完成 OAuth 回调处理
 *
 * 路由：
 * - GET /auth/callback?code=xxx → 处理授权码并重定向
 *
 * OAuth 回调流程：
 * 1. 接收身份提供商返回的授权码
 * 2. 使用授权码向 OpenAuth 服务器交换访问令牌
 * 3. 解码访问令牌获取用户账户 ID 和邮箱
 * 4. 更新浏览器会话存储用户信息
 * 5. 重定向到 /auth 完成认证流程
 *
 * @package console.app
 * @module auth/routes
 */

// 导入重定向函数
import { redirect } from "@solidjs/router"

// 导入 API 事件类型
import type { APIEvent } from "@solidjs/start/server"

// 导入 OpenAuth 客户端和会话管理
import { AuthClient } from "~/context/auth"
import { useAuthSession } from "~/context/auth"

/**
 * OAuth 回调路由处理器
 *
 * 完成 OAuth 2.0 授权流程的回调处理：
 * 1. 从 URL 查询参数中提取授权码
 * 2. 使用授权码向 OpenAuth 服务器交换访问令牌和刷新令牌
 * 3. 解码访问令牌（JWT）获取用户账户信息
 * 4. 更新浏览器的会话存储，保存用户账户
 * 5. 重定向到认证入口，进入应用
 *
 * @param input - API 事件对象，包含请求 URL
 * @returns 成功时重定向到 /auth，失败时返回 500 错误
 *
 * @example
 * GitHub 授权后重定向到：
 * /auth/callback?code=37a42b3f8c4e9d1a
 *
 * 成功流程：
 * - 使用 code 交换令牌
 * - 解码令牌获取账户 ID 和邮箱
 * - 更新会话：{ account: { acc_xxx: { id, email } }, current: acc_xxx }
 * - 重定向到 /auth
 *
 * 失败流程：
 * - 返回 500 错误和错误详情
 */
export async function GET(input: APIEvent) {
  // 解析请求 URL
  const url = new URL(input.request.url)
  try {
    // 从查询参数中提取授权码
    const code = url.searchParams.get("code")
    // 如果没有授权码，抛出错误
    if (!code) throw new Error("No code found")

    // 使用授权码向 OpenAuth 服务器交换访问令牌和刷新令牌
    const result = await AuthClient.exchange(code, `${url.origin}${url.pathname}`)
    // 如果交换失败，抛出错误
    if (result.err) throw new Error(result.err.message)

    // 解码访问令牌（JWT），提取用户信息
    const decoded = AuthClient.decode(result.tokens.access, {} as any)
    // 如果解码失败，抛出错误
    if (decoded.err) throw new Error(decoded.err.message)

    // 获取浏览器会话存储
    const session = await useAuthSession()
    // 从解码的令牌中提取账户 ID
    const id = decoded.subject.properties.accountID

    // 更新会话，添加/更新当前账户信息
    await session.update((value) => {
      return {
        // 保留现有数据
        ...value,
        // 更新账户映射
        account: {
          ...value.account,
          // 添加/更新当前账户
          [id]: {
            id,
            email: decoded.subject.properties.email,
          },
        },
        // 设置为当前活跃账户
        current: id,
      }
    })

    // 成功完成认证，重定向到认证入口
    return redirect("/auth")
  } catch (e: any) {
    // 认证失败，返回错误响应
    return new Response(
      JSON.stringify({
        // 错误消息
        error: e.message,
        // 原始查询参数（用于调试）
        cause: Object.fromEntries(url.searchParams.entries()),
      }),
      { status: 500 },
    )
  }
}
