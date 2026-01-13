/**
 * ============================================================================
 * 文件名：[id].tsx
 * 所属包：packages/console/app/src/routes/workspace
 * ============================================================================
 *
 * 文件作用：
 * 工作区内部页面布局。工作区子页面（Zen、API Keys、Members、Billing、Settings）的共享布局。
 *
 * 主要功能：
 * - 显示工作区导航菜单（桌面端和移动端）
 * - 根据用户角色显示/隐藏管理菜单项
 * - 渲染子路由内容
 *
 * 依赖关系：
 * - solid-js：Show 条件渲染组件
 * - @solidjs/router：路由组件和工具
 * - ./common：会话信息查询
 *
 * 导出内容：
 * - default：工作区内部页面布局组件
 *
 * 路由：
 * - /workspace/[id] → 使用此布局（默认显示 Zen 页面）
 * - /workspace/[id]/keys → 使用此布局
 * - /workspace/[id]/members → 使用此布局
 * - /workspace/[id]/billing → 使用此布局（仅管理员可见）
 * - /workspace/[id]/settings → 使用此布局（仅管理员可见）
 *
 * @package console.app
 * @module workspace/layout
 */

// 导入条件渲染组件
import { Show } from "solid-js"

// 导入路由组件和工具
import { createAsync, RouteSectionProps, useParams, A } from "@solidjs/router"

// 导入会话信息查询
import { querySessionInfo } from "./common"

// 导入工作区内部页面样式
import "./[id].css"

/**
 * 工作区内部页面布局组件
 *
 * 工作区子页面的共享布局，包含：
 * - 桌面端导航菜单
 * - 移动端导航菜单
 * - 主内容区（子路由渲染）
 *
 * 导航菜单项：
 * - Zen：工作区主页
 * - API Keys：API 密钥管理
 * - Members：成员管理
 * - Billing：账单管理（仅管理员可见）
 * - Settings：工作区设置（仅管理员可见）
 *
 * @param props - 路由部分属性，包含子路由内容
 * @returns SolidJS 组件
 *
 * 组件结构：
 * ```tsx
 * <main data-page="workspace">
 *   <div data-component="workspace-container">
 *     <nav data-component="workspace-nav">
 *       <nav data-component="nav-desktop">
 *         <!-- 桌面端导航 -->
 *       </nav>
 *       <nav data-component="nav-mobile">
 *         <!-- 移动端导航 -->
 *       </nav>
 *     </nav>
 *     <div data-component="workspace-content">
 *       {children}
 *     </div>
 *   </div>
 * </main>
 * ```
 */
export default function WorkspaceLayout(props: RouteSectionProps) {
  // 获取路由参数（包含工作区 ID）
  const params = useParams()
  // 异步获取会话信息（管理员权限等）
  const userInfo = createAsync(() => querySessionInfo(params.id!))

  return (
    <main data-page="workspace">
      {/* 工作区容器 */}
      <div data-component="workspace-container">
        {/* 工作区导航 */}
        <nav data-component="workspace-nav">
          {/* 桌面端导航菜单 */}
          <nav data-component="nav-desktop">
            <div data-component="workspace-nav-items">
              {/* Zen 页面链接 */}
              <A href={`/workspace/${params.id}`} end activeClass="active" data-nav-button>
                Zen
              </A>
              {/* API Keys 页面链接 */}
              <A href={`/workspace/${params.id}/keys`} activeClass="active" data-nav-button>
                API Keys
              </A>
              {/* Members 页面链接 */}
              <A href={`/workspace/${params.id}/members`} activeClass="active" data-nav-button>
                Members
              </A>
              {/* 管理员菜单：仅管理员可见 */}
              <Show when={userInfo()?.isAdmin}>
                {/* Billing 页面链接 */}
                <A href={`/workspace/${params.id}/billing`} activeClass="active" data-nav-button>
                  Billing
                </A>
                {/* Settings 页面链接 */}
                <A href={`/workspace/${params.id}/settings`} activeClass="active" data-nav-button>
                  Settings
                </A>
              </Show>
            </div>
          </nav>

          {/* 移动端导航菜单 */}
          <nav data-component="nav-mobile">
            <div data-component="workspace-nav-items">
              {/* Zen 页面链接 */}
              <A href={`/workspace/${params.id}`} end activeClass="active" data-nav-button>
                Zen
              </A>
              {/* API Keys 页面链接 */}
              <A href={`/workspace/${params.id}/keys`} activeClass="active" data-nav-button>
                API Keys
              </A>
              {/* Members 页面链接 */}
              <A href={`/workspace/${params.id}/members`} activeClass="active" data-nav-button>
                Members
              </A>
              {/* 管理员菜单：仅管理员可见 */}
              <Show when={userInfo()?.isAdmin}>
                {/* Billing 页面链接 */}
                <A href={`/workspace/${params.id}/billing`} activeClass="active" data-nav-button>
                  Billing
                </A>
                {/* Settings 页面链接 */}
                <A href={`/workspace/${params.id}/settings`} activeClass="active" data-nav-button>
                  Settings
                </A>
              </Show>
            </div>
          </nav>
        </nav>
        {/* 主内容区：渲染子路由 */}
        <div data-component="workspace-content">{props.children}</div>
      </div>
    </main>
  )
}
