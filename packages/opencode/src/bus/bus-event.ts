/**
 * ============================================================================
 * 文件名：bus-event.ts
 * 所属包：packages/opencode/src/bus
 * ============================================================================
 *
 * 文件作用：
 * 事件定义模块。提供类型安全的事件定义和联合类型生成。
 *
 * 主要功能：
 * - define()：定义事件类型
 * - payloads()：生成所有事件的联合 Schema
 * - 自动注册事件类型
 *
 * 依赖关系：
 * - zod：类型验证和 Schema 定义
 * - ../util/log：日志记录
 *
 * 导出内容：
 * - BusEvent namespace：事件定义命名空间
 *   - Definition 类型：事件定义类型
 *   - define(type, properties)：定义事件
 *   - payloads()：生成联合 Schema
 *
 * 事件定义格式：
 * ```typescript
 * {
 *   type: string,        // 事件类型标识符
 *   properties: ZodType  // 事件属性的 Zod Schema
 * }
 * ```
 *
 * 使用场景：
 * - 定义系统事件类型
 * - 生成类型安全的事件联合
 * - 用于事件总线、消息队列等
 *
 * 使用示例：
 * ```typescript
 * // 定义事件
 * const UserCreated = BusEvent.define(
 *   "user.created",
 *   z.object({
 *     userId: z.string(),
 *     name: z.string(),
 *     email: z.string()
 *   })
 * )
 *
 * const UserUpdated = BusEvent.define(
 *   "user.updated",
 *   z.object({
 *     userId: z.string(),
 *     name: z.string().optional(),
 *     email: z.string().optional()
 *   })
 * )
 *
 * // 获取所有事件的联合 Schema
 * const EventPayloads = BusEvent.payloads()
 * // type EventPayloads =
 * //   | { type: "user.created"; properties: { userId: string; name: string; email: string } }
 * //   | { type: "user.updated"; properties: { userId: string; name?: string; email?: string } }
 * //   | ...
 *
 * // 用于验证
 * const result = EventPayloads.parse(eventData)
 * ```
 *
 * 工作原理：
 * 1. 每次调用 define() 时注册事件类型
 * 2. 注册表维护所有定义的事件
 * 3. payloads() 生成 discriminatedUnion Schema
 * 4. discriminatedUnion 根据 type 字段区分不同事件
 *
 * 类型推断：
 * - Definition 类型包含 type 和 properties
 * - properties 使用 Zod 类型，可以推断出 TypeScript 类型
 * - z.infer<Properties> 获得属性的类型
 *
 * @package opencode
 * @module bus/bus-event
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入 Zod 类型
import type { ZodType } from "zod"

// 导入日志模块
import { Log } from "../util/log"

/**
 * 事件定义命名空间
 *
 * 提供类型安全的事件定义功能。
 */
export namespace BusEvent {
  // 创建日志记录器
  const log = Log.create({ service: "event" })

  /**
   * 事件定义类型
   *
   * 从 define() 函数返回的类型。
   * 包含事件类型标识符和属性 Schema。
   */
  export type Definition = ReturnType<typeof define>

  /**
   * 事件注册表
   *
   * 维护所有已定义的事件类型。
   * 键是事件类型标识符，值是事件定义。
   */
  const registry = new Map<string, Definition>()

  /**
   * 定义事件类型
   *
   * 创建一个新的事件定义并注册到全局注册表。
   *
   * @param type - 事件类型标识符（如 "user.created"）
   * @param properties - 事件属性的 Zod Schema
   * @returns 事件定义对象
   *
   * @template Type - 事件类型字符串字面量
   * @template Properties - Zod Schema 类型
   *
   * 事件定义对象：
   * - type：事件类型标识符
   * - properties：属性的 Zod Schema
   *
   * @example
   * ```typescript
   * const UserCreated = BusEvent.define(
   *   "user.created",
   *   z.object({
   *     userId: z.string(),
   *     name: z.string(),
   *     email: z.string()
   *   })
   * )
   * // UserCreated.type = "user.created"
   * // type UserCreatedProperties = z.infer<typeof UserCreated.properties>
   * // = { userId: string; name: string; email: string }
   * ```
   */
  export function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
    // 构造事件定义对象
    const result = {
      type,
      properties,
    }

    // 注册到全局注册表
    registry.set(type, result)

    return result
  }

  /**
   * 生成所有事件的联合 Schema
   *
   * 根据注册表中所有定义的事件，生成 discriminatedUnion Schema。
   *
   * @returns Zod discriminatedUnion Schema
   *
   * 联合 Schema 结构：
   * ```typescript
   * z.discriminatedUnion("type", [
   *   z.object({ type: "event1", properties: Schema1 }),
   *   z.object({ type: "event2", properties: Schema2 }),
   *   ...
   * ])
   * ```
   *
   * 使用场景：
   * - 验证任意事件的载荷
   * - 定义事件处理器的事件参数类型
   * - 序列化/反序列化事件
   *
   * @example
   * ```typescript
   * // 定义一些事件
   * BusEvent.define("event1", z.object({ a: z.string() }))
   * BusEvent.define("event2", z.object({ b: z.number() }))
   *
   * // 获取联合 Schema
   * const EventPayloads = BusEvent.payloads()
   *
   * // 验证事件数据
   * const result = EventPayloads.parse({ type: "event1", properties: { a: "hello" } })
   * // { type: "event1", properties: { a: "hello" } }
   *
   * // 推断类型
   * type EventPayload = z.infer<typeof EventPayloads>
   * // = { type: "event1"; properties: { a: string } }
   * // | { type: "event2"; properties: { b: number } }
   * ```
   */
  export function payloads() {
    return z
      .discriminatedUnion(
        "type",  // 判别字段
        registry
          .entries()
          .map(([type, def]) => {
            // 为每个事件创建对象 Schema
            return z
              .object({
                type: z.literal(type),          // 事件类型
                properties: def.properties,    // 事件属性
              })
              .meta({
                // 元数据：类型引用名称
                ref: "Event" + "." + def.type,
              })
          })
          .toArray() as any,  // 转换为数组
      )
      .meta({
        // 联合类型的元数据引用
        ref: "Event",
      })
  }
}
