/**
 * ============================================================================
 * 文件名：user-menu.tsx
 * 所属包：packages/console/app/src/routes
 * ============================================================================
 *
 * 文件作用：
 * 用户菜单组件。显示用户邮箱并提供登出功能。
 *
 * 主要功能：
 * - 显示当前用户邮箱作为触发器
 * - 下拉菜单提供登出选项
 * - 处理登出逻辑
 *
 * 依赖关系：
 * - @solidjs/router：服务器动作
 * - solid-js/web：获取请求事件
 * - ~/context/auth：会话管理
 * - ~/component/dropdown：下拉菜单组件
 *
 * 导出内容：
 * - UserMenu：用户菜单组件
 * - logout：登出服务端动作
 *
 * @package console.app
 * @module workspace/components
 */

// 导入服务器动作工具
import { action } from "@solidjs/router"

// 导入获取请求事件函数
import { getRequestEvent } from "solid-js/web"

// 导入会话管理
import { useAuthSession } from "~/context/auth"

// 导入下拉菜单组件
import { Dropdown } from "~/component/dropdown"

// 导入用户菜单样式
import "./user-menu.css"

/**
 * 登出服务端动作
 *
 * 处理用户登出请求，从会话中删除当前账户。
 *
 * 服务端标记：
 * - "use server"：标记为服务端函数
 *
 * 处理流程：
 * 1. 获取会话存储
 * 2. 获取当前账户 ID
 * 3. 从会话中删除当前账户
 * 4. 切换到下一个可用账户（如果有）
 * 5. 清除请求的 Actor 上下文
 */
const logout = action(async () => {
  // 标记为服务端函数
  "use server"
  // 获取会话存储
  const auth = await useAuthSession()
  // 获取当前请求事件
  const event = getRequestEvent()
  // 获取当前账户 ID
  const current = auth.data.current
  // 如果有当前账户，执行登出
  if (current)
    await auth.update((val) => {
      // 从账户映射中删除当前账户
      delete val.account?.[current]
      // 获取剩余账户中的第一个
      const first = Object.keys(val.account ?? {})[0]
      // 设置为当前账户（如果没有则为 undefined）
      val.current = first
      // 清除当前请求的 Actor 上下文
      event!.locals.actor = undefined
      return val
    })
}, "auth.logout")

/**
 * 用户菜单组件
 *
 * 显示用户邮箱和登出选项的下拉菜单。
 *
 * @param props.email - 用户邮箱地址
 * @returns SolidJS 组件
 *
 * 组件结构：
 * ```tsx
 * <div data-component="user-menu">
 *   <Dropdown trigger={email}>
 *     <a href="/auth/logout">Logout</a>
 *   </Dropdown>
 * </div>
 * ```
 */
export function UserMenu(props: { email: string | null | undefined }) {
  return (
    <div data-component="user-menu">
      {/* 用户菜单下拉菜单 */}
      {/* 触发器显示用户邮箱 */}
      <Dropdown trigger={props.email ?? ""} align="right">
        {/* 登出链接 */}
        <a href="/auth/logout" data-slot="item">
          Logout
        </a>
      </Dropdown>
    </div>
  )
}
