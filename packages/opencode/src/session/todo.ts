/**
 * ============================================================================
 * 文件名：todo.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 待办事项（Todo）管理模块。为会话提供待办事项的存储和查询功能。
 *
 * 主要功能：
 * - Info：待办事项类型定义
 * - Event.Updated：待办事项更新事件
 * - update(input)：更新会话的待办事项
 * - get(sessionID)：获取会话的待办事项
 *
 * 依赖关系：
 * - ../bus/bus-event：事件定义
 * - ../bus：事件总线
 * - zod：类型验证
 * - ../storage/storage：持久化存储
 *
 * 导出内容：
 * - Todo namespace：待办事项命名空间
 *   - Info：待办事项类型
 *   - Event：待办事项事件
 *   - update()：更新待办事项
 *   - get()：获取待办事项
 *
 * 待办事项属性：
 * - content：任务描述
 * - status：状态（pending/in_progress/completed/cancelled）
 * - priority：优先级（high/medium/low）
 * - id：唯一标识符
 *
 * @package opencode
 * @module session/todo
 */

// 导入事件定义
import { BusEvent } from "@/bus/bus-event"

// 导入事件总线
import { Bus } from "@/bus"

// 导入 Zod 类型验证
import z from "zod"

// 导入存储模块
import { Storage } from "../storage/storage"

/**
 * 待办事项命名空间
 *
 * 管理会话的待办事项列表。
 */
export namespace Todo {
  /**
   * 待办事项类型定义
   *
   * 定义单个待办事项的结构。
   */
  export const Info = z
    .object({
      // 任务内容/描述
      content: z.string().describe("Brief description of the task"),
      // 任务状态
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      // 优先级
      priority: z.string().describe("Priority level of the task: high, medium, low"),
      // 唯一标识符
      id: z.string().describe("Unique identifier for the todo item"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  /**
   * 待办事项事件
   *
   * 定义与待办事项相关的事件。
   */
  export const Event = {
    /**
     * 待办事项更新事件
     *
     * 当待办事项发生变化时发布。
     */
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        // 会话 ID
        sessionID: z.string(),
        // 待办事项列表
        todos: z.array(Info),
      }),
    ),
  }

  /**
   * 更新会话的待办事项
   *
   * 保存待办事项列表并发布更新事件。
   *
   * @param input - 更新参数
   *   - sessionID：会话 ID
   *   - todos：待办事项列表
   * @returns Promise
   */
  export async function update(input: { sessionID: string; todos: Info[] }) {
    // 写入存储
    await Storage.write(["todo", input.sessionID], input.todos)

    // 发布更新事件
    Bus.publish(Event.Updated, input)
  }

  /**
   * 获取会话的待办事项
   *
   * @param sessionID - 会话 ID
   * @returns Promise，解析为待办事项列表
   */
  export async function get(sessionID: string) {
    return Storage.read<Info[]>(["todo", sessionID])
      .then((x) => x || [])
      .catch(() => [])
  }
}
