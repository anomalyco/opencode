/**
 * ============================================================================
 * 文件名：logout.ts
 * 所属包：packages/console/app/src/routes/auth
 * ============================================================================
 *
 * 文件作用：
 * 用户登出路由。处理用户退出登录的逻辑。
 *
 * 主要功能：
 * - 从会话中删除当前账户信息
 * - 切换到下一个可用账户（如果有）
 * - 清除当前请求的 Actor 上下文
 * - 重定向到 zen 模式页面
 *
 * 依赖关系：
 * - @solidjs/router：重定向函数
 * - @solidjs/start：API 事件类型
 * - ~/context/auth：会话管理
 *
 * 导出内容：
 * - GET：处理 GET 请求，执行登出逻辑
 *
 * 路由：
 * - GET /auth/logout → 登出并重定向到 /zen
 *
 * 多账户处理：
 * - 如果用户登录了多个账户，删除当前账户后会切换到下一个账户
 * - 如果没有其他账户，current 将为 undefined
 *
 * @package console.app
 * @module auth/routes
 */

// 导入重定向函数
import { redirect } from "@solidjs/router"

// 导入 API 事件类型
import { APIEvent } from "@solidjs/start"

// 导入会话管理
import { useAuthSession } from "~/context/auth"

/**
 * 用户登出路由处理器
 *
 * 处理用户退出登录的请求：
 * 1. 获取当前会话和当前账户 ID
 * 2. 从会话的账户映射中删除当前账户
 * 3. 如果还有其他账户，将第一个账户设为当前账户
 * 4. 清除当前请求的 Actor 上下文（强制重新认证）
 * 5. 重定向到 zen 模式页面
 *
 * @param event - API 事件对象
 * @returns 重定向到 /zen
 *
 * @example
 * 用户访问 /auth/logout：
 * - 删除当前账户 acc_123
 * - 如果还有账户 acc_456，切换到 acc_456
 * - 如果没有其他账户，current 为 undefined
 * - 清除 Actor 上下文
 * - 重定向到 /zen
 */
export async function GET(event: APIEvent) {
  // 获取会话存储
  const auth = await useAuthSession()
  // 获取当前账户 ID
  const current = auth.data.current

  // 如果有当前账户，执行登出逻辑
  if (current)
    await auth.update((val) => {
      // 从账户映射中删除当前账户
      delete val.account?.[current]
      // 获取剩余账户中的第一个
      const first = Object.keys(val.account ?? {})[0]
      // 设置为当前账户（如果没有则为 undefined）
      val.current = first
      // 清除当前请求的 Actor 上下文
      // 这将强制下一个请求重新认证
      event!.locals.actor = undefined
      return val
    })

  // 重定向到 zen 模式页面
  return redirect("/zen")
}
