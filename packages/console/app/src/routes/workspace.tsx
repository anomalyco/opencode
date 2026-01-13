/**
 * ============================================================================
 * 文件名：workspace.tsx
 * 所属包：packages/console/app/src/routes
 * ============================================================================
 *
 * 文件作用：
 * 工作区布局组件。工作区页面（/workspace/[id]）的顶层布局组件。
 *
 * 主要功能：
 * - 显示工作区头部导航（包含工作区选择器和用户菜单）
 * - 获取并显示当前用户邮箱
 * - 渲染子路由内容
 *
 * 依赖关系：
 * - @solidjs/router：路由组件和工具
 * - ~/context/auth.withActor：Actor 上下文包装器
 * - @opencode-ai/console-core/user.js：用户管理
 * - @opencode-ai/console-core/actor.js：Actor 上下文
 * - ./component/icon：工作区 Logo 图标
 * - ./workspace-picker：工作区选择器组件
 * - ./user-menu：用户菜单组件
 *
 * 导出内容：
 * - default：工作区布局组件
 * - getUserEmail：获取用户邮箱的服务端查询函数
 *
 * 路由：
 * - /workspace/[id]/* → 使用此布局
 *
 * @package console.app
 * @module workspace/layout
 */

// 导入 SolidJS Router 组件和工具
import { query, createAsync, RouteSectionProps, useParams, A } from "@solidjs/router"

// 导入工作区样式
import "./workspace.css"

// 导入工作区 Logo 图标
import { IconWorkspaceLogo } from "../component/icon"

// 导入工作区选择器组件
import { WorkspacePicker } from "./workspace-picker"

// 导入用户菜单组件
import { UserMenu } from "./user-menu"

// 导入 Actor 上下文包装器
import { withActor } from "~/context/auth.withActor"

// 导入用户管理模块
import { User } from "@opencode-ai/console-core/user.js"

// 导入 Actor 上下文管理
import { Actor } from "@opencode-ai/console-core/actor.js"

/**
 * 获取用户邮箱
 *
 * 服务端查询函数，获取当前用户在指定工作区中的邮箱地址。
 *
 * @param workspaceID - 工作区 ID
 * @returns 用户邮箱地址
 *
 * 服务端标记：
 * - "use server"：标记为服务端函数，在服务器上执行
 */
const getUserEmail = query(async (workspaceID: string) => {
  // 标记为服务端函数
  "use server"
  // 使用 Actor 上下文执行查询
  return withActor(async () => {
    // 断言为用户级别的 Actor
    const actor = Actor.assert("user")
    // 获取用户的认证邮箱
    const email = await User.getAuthEmail(actor.properties.userID)
    return email
  }, workspaceID)
}, "userEmail")

/**
 * 工作区布局组件
 *
 * 工作区页面的顶层布局，包含：
 * - 头部导航：工作区 Logo、工作区选择器、用户菜单
 * - 主内容区：子路由渲染
 *
 * @param props - 路由部分属性，包含子路由内容
 * @returns SolidJS 组件
 *
 * 组件结构：
 * ```tsx
 * <main data-page="workspace">
 *   <header>
 *     <div data-slot="header-brand">
 *       <A href="/">Logo</A>
 *       <WorkspacePicker />
 *     </div>
 *     <div data-slot="header-actions">
 *       <UserMenu />
 *     </div>
 *   </header>
 *   <div>{children}</div>
 * </main>
 * ```
 */
export default function WorkspaceLayout(props: RouteSectionProps) {
  // 获取路由参数（包含工作区 ID）
  const params = useParams()
  // 异步获取用户邮箱
  const userEmail = createAsync(() => getUserEmail(params.id!))

  return (
    <main data-page="workspace">
      {/* 工作区头部导航 */}
      <header data-component="workspace-header">
        {/* 左侧：Logo 和工作区选择器 */}
        <div data-slot="header-brand">
          {/* 网站 Logo 链接 */}
          <A href="/" data-component="site-title">
            <IconWorkspaceLogo />
          </A>
          {/* 工作区选择下拉菜单 */}
          <WorkspacePicker />
        </div>
        {/* 右侧：用户菜单 */}
        <div data-slot="header-actions">
          {/* 显示用户邮箱和登出选项 */}
          <UserMenu email={userEmail()} />
        </div>
      </header>
      {/* 子路由内容区域 */}
      <div>{props.children}</div>
    </main>
  )
}
