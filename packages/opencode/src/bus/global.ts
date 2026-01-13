/**
 * ============================================================================
 * 文件名：global.ts
 * 所属包：packages/opencode/src/bus
 * ============================================================================
 *
 * 文件作用：
 * 全局事件总线。提供跨实例通信的 EventEmitter，用于不同实例之间的事件传递。
 *
 * 主要功能：
 * - 发射事件到全局事件总线
 * - 在多个实例之间共享事件
 * - 用于跨实例的通信和同步
 *
 * 依赖关系：
 * - events：Node.js 事件发射器模块
 *
 * 导出内容：
 * - GlobalBus：全局事件总线实例
 *   - emit("event", payload)：发射事件
 *   - on("event", callback)：监听事件
 *
 * 事件类型：
 * - event：事件载荷
 *   - directory?：可选的实例目录
 *   - payload：任意事件载荷数据
 *
 * 工作流程：
 * 1. 实例 A 发布本地事件到 Bus
 * 2. Bus 将事件转发到 GlobalBus
 * 3. 其他监听 GlobalBus 的实例收到事件
 *
 * 使用场景：
 * - 跨实例通信
 * - 多实例同步
 * - 全局事件广播
 *
 * 使用示例：
 * ```typescript
 * // 发射事件
 * GlobalBus.emit("event", {
 *   directory: "/path/to/instance",
 *   payload: {
 *     type: "user.updated",
 *     properties: { userId: "123" }
 *   }
 * })
 *
 * // 监听事件
 * GlobalBus.on("event", (data) => {
 *   console.log("收到事件:", data.payload)
 * })
 * ```
 *
 * 注意事项：
 * - GlobalBus 是全局单例
 * - 事件可以被任何监听者接收
 * - 用于跨实例通信，不是本地事件总线
 *
 * @package opencode
 * @module bus/global
 */

// 导入 Node.js 内置的 EventEmitter 类
// EventEmitter 提供发布-订阅模式的事件系统
import { EventEmitter } from "events"

/**
 * 全局事件总线
 *
 * 使用 EventEmitter 创建一个类型安全的事件总线。
 * 用于在不同实例之间传递事件。
 *
 * 事件签名：
 * - "event"：事件名称
 * - 参数数组：包含事件载荷的对象
 *
 * 载荷结构：
 * - directory?：可选的实例目录路径，用于标识事件来源
 * - payload：任意类型的事件载荷数据
 *
 * 使用场景：
 * - 跨实例事件同步
 * - 多实例协调
 * - 全局状态广播
 *
 * @example
 * ```typescript
 * // 发射事件
 * GlobalBus.emit("event", {
 *   directory: "/path/to/instance",
 *   payload: { type: "project.updated", properties: {...} }
 * })
 *
 * // 监听事件
 * GlobalBus.on("event", ({ directory, payload }) => {
 *   console.log("来自", directory, "的事件:", payload)
 * })
 *
 * // 移除监听器
 * const listener = ({ payload }) => console.log(payload)
 * GlobalBus.on("event", listener)
 * GlobalBus.off("event", listener)
 * ```
 */
export const GlobalBus = new EventEmitter<{
  // 事件类型：event
  // 参数是一个包含可选目录和载荷的对象
  event: [
    {
      // 可选的实例目录路径，标识事件来源实例
      directory?: string
      // 事件载荷，可以是任意数据
      payload: any
    },
  ]
}>()
