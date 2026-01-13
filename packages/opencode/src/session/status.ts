/**
 * ============================================================================
 * 文件名：status.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 会话状态管理模块。跟踪和管理会话的运行状态（idle、busy、retry）。
 *
 * 主要功能：
 * - Info：状态类型定义（idle/retry/busy）
 * - Event.Status/Event.Idle：状态事件
 * - get(sessionID)：获取会话状态
 * - list()：获取所有会话状态
 * - set(sessionID, status)：设置会话状态
 *
 * 依赖关系：
 * - ../bus/bus-event：事件定义
 * - ../bus：事件总线
 * - ../project/instance：实例状态管理
 * - zod：类型验证
 *
 * 导出内容：
 * - SessionStatus namespace：会话状态命名空间
 *   - Info：状态类型
 *   - Event：状态事件
 *   - get()：获取状态
 *   - list()：列出所有状态
 *   - set()：设置状态
 *
 * 状态类型：
 * - idle：会话空闲
 * - retry：会话正在重试
 * - busy：会话正在处理
 *
 * @package opencode
 * @module session/status
 */

// 导入事件定义
import { BusEvent } from "@/bus/bus-event"

// 导入事件总线
import { Bus } from "@/bus"

// 导入实例管理
import { Instance } from "@/project/instance"

// 导入 Zod 类型验证
import z from "zod"

/**
 * 会话状态命名空间
 *
 * 管理会话的运行状态。
 */
export namespace SessionStatus {
  /**
   * 状态类型定义
   *
   * 使用联合类型表示三种可能的状态。
   */
  export const Info = z
    .union([
      // 空闲状态
      z.object({
        type: z.literal("idle"),
      }),
      // 重试状态
      z.object({
        type: z.literal("retry"),
        // 重试次数
        attempt: z.number(),
        // 重试消息
        message: z.string(),
        // 下次重试时间戳
        next: z.number(),
      }),
      // 忙碌状态
      z.object({
        type: z.literal("busy"),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  /**
   * 状态事件
   *
   * 定义与会话状态相关的事件。
   */
  export const Event = {
    /**
     * 状态更新事件
     *
     * 当会话状态发生变化时发布。
     */
    Status: BusEvent.define(
      "session.status",
      z.object({
        // 会话 ID
        sessionID: z.string(),
        // 新状态
        status: Info,
      }),
    ),

    /**
     * 空闲事件（已废弃）
     *
     * @deprecated 使用 Event.Status 代替
     */
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  /**
   * 状态存储
   *
   * 实例级状态，记录每个会话的当前状态。
   */
  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  /**
   * 获取会话状态
   *
   * @param sessionID - 会话 ID
   * @returns 会话状态，默认为 idle
   */
  export function get(sessionID: string) {
    return (
      state()[sessionID] ?? {
        type: "idle",
      }
    )
  }

  /**
   * 获取所有会话状态
   *
   * @returns 所有会话状态的对象
   */
  export function list() {
    return state()
  }

  /**
   * 设置会话状态
   *
   * 更新会话状态并发布事件。
   * 空闲状态会从状态存储中移除（节省内存）。
   *
   * @param sessionID - 会话 ID
   * @param status - 新状态
   */
  export function set(sessionID: string, status: Info) {
    // 发布状态更新事件
    Bus.publish(Event.Status, {
      sessionID,
      status,
    })

    // 如果是空闲状态，发布废弃的空闲事件并移除状态
    if (status.type === "idle") {
      // 发布废弃的空闲事件
      Bus.publish(Event.Idle, {
        sessionID,
      })
      // 从存储中移除
      delete state()[sessionID]
      return
    }

    // 存储非空闲状态
    state()[sessionID] = status
  }
}
