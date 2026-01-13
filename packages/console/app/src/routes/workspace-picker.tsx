/**
 * ============================================================================
 * 文件名：workspace-picker.tsx
 * 所属包：packages/console/app/src/routes
 * ============================================================================
 *
 * 文件作用：
 * 工作区选择器组件。允许用户在不同工作区之间切换，或创建新工作区。
 *
 * 主要功能：
 * - 显示当前工作区名称
 * - 下拉菜单列出所有可用工作区
 * - 切换到其他工作区
 * - 创建新工作区的模态对话框
 *
 * 依赖关系：
 * - @solidjs/router：路由工具和服务器动作
 * - solid-js：响应式原语和组件
 * - ~/context/auth.withActor：Actor 上下文包装器
 * - @opencode-ai/console-core：核心功能模块
 * - ~/component/dropdown：下拉菜单组件
 * - ~/component/modal：模态对话框组件
 *
 * 导出内容：
 * - WorkspacePicker：工作区选择器组件
 * - getWorkspaces：获取工作区列表的服务端查询
 * - createWorkspace：创建新工作区的服务端动作
 *
 * @package console.app
 * @module workspace/components
 */

// 导入 SolidJS Router 工具
import { query, useParams, action, createAsync, redirect, useSubmission } from "@solidjs/router"

// 导入 SolidJS 核心功能
import { For, Show, createEffect } from "solid-js"

// 导入 SolidJS Store
import { createStore } from "solid-js/store"

// 导入 Actor 上下文包装器
import { withActor } from "~/context/auth.withActor"

// 导入 Actor 上下文管理
import { Actor } from "@opencode-ai/console-core/actor.js"

// 导入 Drizzle ORM 操作符和数据库
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"

// 导入工作区数据表模型
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"

// 导入用户数据表模型
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"

// 导入工作区管理
import { Workspace } from "@opencode-ai/console-core/workspace.js"

// 导入下拉菜单组件
import { Dropdown, DropdownItem } from "~/component/dropdown"

// 导入模态对话框组件
import { Modal } from "~/component/modal"

// 导入工作区选择器样式
import "./workspace-picker.css"

/**
 * 获取用户的工作区列表
 *
 * 服务端查询函数，获取当前账户有权访问的所有工作区。
 *
 * @returns 工作区列表（包含 id、name、slug）
 *
 * 服务端标记：
 * - "use server"：标记为服务端函数
 *
 * 查询逻辑：
 * - 从 UserTable 和 WorkspaceTable 关联查询
 * - 筛选当前账户的用户记录
 * - 排除已删除的工作区和用户记录
 */
const getWorkspaces = query(async () => {
  // 标记为服务端函数
  "use server"
  // 使用 Actor 上下文执行查询
  return withActor(async () => {
    return Database.use((tx) =>
      tx
        // 选择工作区 ID、名称、slug
        .select({
          id: WorkspaceTable.id,
          name: WorkspaceTable.name,
          slug: WorkspaceTable.slug,
        })
        // 从用户表开始
        .from(UserTable)
        // 关联工作区表
        .innerJoin(WorkspaceTable, eq(UserTable.workspaceID, WorkspaceTable.id))
        // 筛选条件
        .where(
          and(
            // 属于当前账户
            eq(UserTable.accountID, Actor.account()),
            // 工作区未删除
            isNull(WorkspaceTable.timeDeleted),
            // 用户未删除
            isNull(UserTable.timeDeleted),
          ),
        ),
    )
  })
}, "workspaces")

/**
 * 创建新工作区
 *
 * 服务端动作，处理创建新工作区的表单提交。
 *
 * @param form - 表单数据，包含 workspaceName 字段
 * @returns 重定向到新工作区页面
 *
 * 服务端标记：
 * - "use server"：标记为服务端函数
 *
 * 处理流程：
 * 1. 从表单数据中提取工作区名称
 * 2. 调用 Workspace.create 创建工作区
 * 3. 重定向到新工作区页面
 */
const createWorkspace = action(async (form: FormData) => {
  // 标记为服务端函数
  "use server"
  // 从表单中获取工作区名称
  const name = form.get("workspaceName") as string
  // 如果名称不为空，创建工作区
  if (name?.trim()) {
    return withActor(async () => {
      // 创建新工作区
      const workspaceID = await Workspace.create({ name: name.trim() })
      // 重定向到新工作区页面
      return redirect(`/workspace/${workspaceID}`)
    })
  }
}, "createWorkspace")

/**
 * 工作区选择器组件
 *
 * 提供工作区切换和创建功能：
 * - 显示当前工作区名称
 * - 下拉菜单列出所有工作区
 * - 点击切换到其他工作区
 * - 创建新工作区的模态对话框
 *
 * @returns SolidJS 组件
 *
 * UI 结构：
 * ```tsx
 * <div data-component="workspace-picker">
 *   <Dropdown trigger={currentWorkspace}>
 *     <For each={workspaces}>
 *       <DropdownItem>workspace.name</DropdownItem>
 *     </For>
 *     <button>+ Create New Workspace</button>
 *   </Dropdown>
 *   <Modal title="Create New Workspace">
 *     <form action={createWorkspace}>
 *       <input name="workspaceName" />
 *       <button type="submit">Create</button>
 *     </form>
 *   </Modal>
 * </div>
 * ```
 */
export function WorkspacePicker() {
  // 获取路由参数（包含当前工作区 ID）
  const params = useParams()
  // 异步获取工作区列表
  const workspaces = createAsync(() => getWorkspaces())
  // 获取创建工作区的提交状态
  const submission = useSubmission(createWorkspace)
  // 创建本地 store 管理模态框状态
  const [store, setStore] = createStore({
    showForm: false, // 是否显示创建表单
  })
  // 输入框引用
  let inputRef: HTMLInputElement | undefined

  /**
   * 获取当前工作区名称
   *
   * @returns 当前工作区名称，或 "Select workspace"
   */
  const currentWorkspace = () => {
    // 从工作区列表中查找当前工作区
    const ws = workspaces()?.find((w) => w.id === params.id)
    // 返回工作区名称，或默认文本
    return ws ? ws.name : "Select workspace"
  }

  /**
   * 显示创建工作区表单
   */
  const handleWorkspaceNew = () => {
    setStore("showForm", true)
  }

  /**
   * 表单显示时自动聚焦输入框
   */
  createEffect(() => {
    if (store.showForm && inputRef) {
      // 在下一个事件循环中聚焦
      setTimeout(() => inputRef?.focus(), 0)
    }
  })

  /**
   * 选择工作区
   *
   * @param workspaceID - 要切换到的工作区 ID
   */
  const handleSelectWorkspace = (workspaceID: string) => {
    // 如果点击的是当前工作区，不做任何操作
    if (workspaceID === params.id) return
    // 导航到新工作区
    window.location.href = `/workspace/${workspaceID}`
  }

  // 当工作区 ID 变化时，隐藏创建表单
  createEffect(() => {
    params.id
    setStore("showForm", false)
  })

  return (
    <div data-component="workspace-picker">
      {/* 工作区选择下拉菜单 */}
      <Dropdown trigger={currentWorkspace()} align="left">
        {/* 列出所有工作区 */}
        <For each={workspaces()}>
          {(workspace) => (
            <DropdownItem selected={workspace.id === params.id} onClick={() => handleSelectWorkspace(workspace.id)}>
              {/* 显示工作区名称或 slug */}
              {workspace.name || workspace.slug}
            </DropdownItem>
          )}
        </For>
        {/* 创建新工作区按钮 */}
        <button data-slot="create-item" type="button" onClick={() => handleWorkspaceNew()}>
          + Create New Workspace
        </button>
      </Dropdown>

      {/* 创建工作区的模态对话框 */}
      <Modal open={store.showForm} onClose={() => setStore("showForm", false)} title="Create New Workspace">
        {/* 创建工作区表单 */}
        <form data-slot="create-form" action={createWorkspace} method="post">
          <div data-slot="create-input-group">
            {/* 工作区名称输入框 */}
            <input
              ref={inputRef}
              data-slot="create-input"
              type="text"
              name="workspaceName"
              placeholder="Enter workspace name"
              required
            />
            {/* 按钮组 */}
            <div data-slot="button-group">
              {/* 取消按钮 */}
              <button type="button" data-color="ghost" onClick={() => setStore("showForm", false)}>
                Cancel
              </button>
              {/* 提交按钮 */}
              <button type="submit" data-color="primary" disabled={submission.pending}>
                {submission.pending ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
