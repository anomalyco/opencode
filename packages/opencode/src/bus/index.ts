/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/bus
 * ============================================================================
 *
 * 文件作用：
 * 事件总线模块。提供发布-订阅模式的事件系统。
 *
 * 主要功能：
 * - publish()：发布事件
 * - subscribe()：订阅特定类型的事件
 * - once()：一次性订阅
 * - subscribeAll()：订阅所有事件
 * - 类型安全的事件定义
 *
 * 依赖关系：
 * - zod：类型验证和事件定义
 * - ../util/log：日志记录
 * - ../project/instance：实例状态管理
 * - ./bus-event：事件定义工具
 * - ./global：全局事件总线
 *
 * 导出内容：
 * - Bus namespace：事件总线命名空间
 *   - InstanceDisposed：实例已释放事件
 *   - publish(def, properties)：发布事件
 *   - subscribe(def, callback)：订阅事件
 *   - once(def, callback)：一次性订阅
 *   - subscribeAll(callback)：订阅所有事件
 *
 * 事件类型：
 * - server.instance.disposed：实例已释放
 *
 * 工作流程：
 * 1. 使用 BusEvent.define() 定义事件类型
 * 2. 使用 Bus.subscribe() 订阅事件
 * 3. 使用 Bus.publish() 发布事件
 * 4. 所有订阅者收到通知
 *
 * 通配符订阅：
 * - 订阅 "*" 可以接收所有事件
 * - 用于日志记录、调试等
 *
 * 使用场景：
 * - 组件间通信
 * - 状态变更通知
 * - 生命周期事件
 * - 跨模块通信
 *
 * 使用示例：
 * ```typescript
 * // 定义事件
 * const UserUpdated = BusEvent.define(
 *   "user.updated",
 *   z.object({
 *     userId: z.string(),
 *     name: z.string(),
 *   })
 * )
 *
 * // 订阅事件
 * const unsub = Bus.subscribe(UserUpdated, (event) => {
 *   console.log("用户更新:", event.properties)
 * })
 *
 * // 发布事件
 * await Bus.publish(UserUpdated, {
 *   userId: "123",
 *   name: "张三"
 * })
 *
 * // 一次性订阅
 * Bus.once(UserUpdated, (event) => {
 *   console.log("只触发一次")
 *   return "done"  // 返回 "done" 会取消订阅
 * })
 *
 * // 订阅所有事件
 * Bus.subscribeAll((event) => {
 *   console.log("事件:", event.type)
 * })
 *
 * // 取消订阅
 * unsub()
 * ```
 *
 * 类型安全：
 * - 事件类型通过 Zod Schema 定义
 * - 发布和订阅都进行类型检查
 * - properties 类型自动推断
 *
 * 实例生命周期：
 * - 当实例释放时，自动通知通配符订阅者
 * - 使用 Instance.state 管理生命周期
 *
 * @package opencode
 * @module bus
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入日志模块
import { Log } from "../util/log"

// 导入实例状态管理
import { Instance } from "../project/instance"

// 导入事件定义工具
import { BusEvent } from "./bus-event"

// 导入全局事件总线
import { GlobalBus } from "./global"

/**
 * 事件总线命名空间
 *
 * 提供类型安全的发布-订阅事件系统。
 */
export namespace Bus {
  // 创建日志记录器
  const log = Log.create({ service: "bus" })

  /**
   * 订阅函数类型
   *
   * 接收事件对象作为参数的函数。
   */
  type Subscription = (event: any) => void

  /**
   * 实例已释放事件
   *
   * 当项目实例被释放时触发。
   *
   * 属性：
   * - directory：实例目录路径
   */
  export const InstanceDisposed = BusEvent.define(
    "server.instance.disposed",
    z.object({
      directory: z.string(),
    }),
  )

  /**
   * 事件总线状态
   *
   * 使用 Instance.state 管理，在实例释放时自动通知订阅者。
   */
  const state = Instance.state(
    () => {
      // 订阅者映射：事件类型 -> 订阅函数数组
      const subscriptions = new Map<any, Subscription[]>()

      return {
        subscriptions,
      }
    },
    async (entry) => {
      // 实例释放时的清理函数
      const wildcard = entry.subscriptions.get("*")
      if (!wildcard) return

      // 构造实例释放事件
      const event = {
        type: InstanceDisposed.type,
        properties: {
          directory: Instance.directory,
        },
      }

      // 通知所有通配符订阅者
      for (const sub of [...wildcard]) {
        sub(event)
      }
    },
  )

  /**
   * 发布事件
   *
   * 向所有订阅者发布事件。
   *
   * @param def - 事件定义（来自 BusEvent.define）
   * @param properties - 事件属性（必须通过 Zod 验证）
   * @returns Promise，所有订阅者处理完成时 resolve
   *
   * 执行流程：
   * 1. 构造事件载荷（type + properties）
   * 2. 记录日志
   * 3. 通知匹配的订阅者（特定类型 + 通配符）
   * 4. 发送到全局事件总线
   * 5. 等待所有订阅者完成
   *
   * @template Definition - 事件定义类型
   *
   * @example
   * ```typescript
   * await Bus.publish(UserUpdated, {
   *   userId: "123",
   *   name: "张三"
   * })
   * ```
   */
  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    // 构造事件载荷
    const payload = {
      type: def.type,
      properties,
    }

    // 记录发布日志
    log.info("publishing", {
      type: def.type,
    })

    // 收集所有待执行的订阅者
    const pending = []

    // 遍历特定类型和通配符订阅
    for (const key of [def.type, "*"]) {
      const match = state().subscriptions.get(key)
      for (const sub of match ?? []) {
        pending.push(sub(payload))
      }
    }

    // 发送到全局事件总线
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    })

    // 等待所有订阅者完成
    return Promise.all(pending)
  }

  /**
   * 订阅特定类型的事件
   *
   * @param def - 事件定义
   * @param callback - 事件处理回调
   * @returns 取消订阅函数
   *
   * @template Definition - 事件定义类型
   *
   * @example
   * ```typescript
   * const unsub = Bus.subscribe(UserUpdated, (event) => {
   *   console.log(event.properties.userId)
   * })
   *
   * // 取消订阅
   * unsub()
   * ```
   */
  export function subscribe<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: {
      type: Definition["type"]
      properties: z.infer<Definition["properties"]>
    }) => void,
  ) {
    return raw(def.type, callback)
  }

  /**
   * 一次性订阅事件
   *
   * 订阅后，当回调返回 "done" 时自动取消订阅。
   *
   * @param def - 事件定义
   * @param callback - 事件处理回调，返回 "done" 取消订阅
   * @returns 取消订阅函数
   *
   * @template Definition - 事件定义类型
   *
   * @example
   * ```typescript
   * Bus.once(UserUpdated, (event) => {
   *   console.log("第一次更新")
   *   return "done"  // 取消订阅
   * })
   * ```
   */
  export function once<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: {
      type: Definition["type"]
      properties: z.infer<Definition["properties"]>
    }) => "done" | undefined,
  ) {
    // 创建订阅
    const unsub = subscribe(def, (event) => {
      // 调用回调
      const result = callback(event)
      // 如果返回 "done"，取消订阅
      if (result) unsub()
    })
    return unsub
  }

  /**
   * 订阅所有事件
   *
   * 使用通配符订阅，接收所有类型的事件。
   *
   * @param callback - 事件处理回调
   * @returns 取消订阅函数
   *
   * 使用场景：
   * - 日志记录
   * - 调试
   * - 监控
   *
   * @example
   * ```typescript
   * Bus.subscribeAll((event) => {
   *   console.log("事件:", event.type, event.properties)
   * })
   * ```
   */
  export function subscribeAll(callback: (event: any) => void) {
    return raw("*", callback)
  }

  /**
   * 底层订阅函数
   *
   * 直接订阅指定类型的事件。
   *
   * @param type - 事件类型（"*" 表示通配符）
   * @param callback - 事件处理回调
   * @returns 取消订阅函数
   *
   * @example
   * ```typescript
   * const unsub = raw("user.updated", (event) => {
   *   console.log(event)
   * })
   * ```
   */
  function raw(type: string, callback: (event: any) => void) {
    // 记录订阅日志
    log.info("subscribing", { type })

    // 获取订阅者映射
    const subscriptions = state().subscriptions

    // 获取或创建该类型的订阅者数组
    let match = subscriptions.get(type) ?? []
    match.push(callback)
    subscriptions.set(type, match)

    // 返回取消订阅函数
    return () => {
      // 记录取消订阅日志
      log.info("unsubscribing", { type })

      // 获取订阅者数组
      const match = subscriptions.get(type)
      if (!match) return

      // 查找回调的索引
      const index = match.indexOf(callback)
      if (index === -1) return

      // 从数组中移除
      match.splice(index, 1)
    }
  }
}
