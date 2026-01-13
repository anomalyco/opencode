/**
 * ============================================================================
 * 文件名：black.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * Black（黑名单/限制）配置数据管理模块。提供访问和验证黑名单配置的功能。
 *
 * 主要功能：
 * - 获取黑名单配置
 * - 验证黑名单数据格式
 *
 * 配置说明：
 * Black 配置包含三种限制类型：
 * - fixedLimit：固定限制（硬限制）
 * - rollingLimit：滚动限制（时间窗口内的限制）
 * - rollingWindow：滚动窗口时长（秒）
 *
 * 依赖关系：
 * - zod：运行时类型验证
 * - ./util/fn：函数包装工具
 * - @opencode-ai/console-resource：Black 配置资源
 *
 * 导出内容：
 * - BlackData.validate：验证黑名单数据格式
 * - BlackData.get：获取黑名单配置
 *
 * 使用场景：
 * - 访问控制
 * - 速率限制
 * - 配额管理
 *
 * @package console.core
 * @module black
 */

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入函数包装工具
import { fn } from "./util/fn"

// 导入资源管理模块（包含 Black 配置）
import { Resource } from "@opencode-ai/console-resource"

/**
 * BlackData 命名空间
 *
 * 包含所有黑名单配置相关的操作函数。
 */
export namespace BlackData {
  /**
   * Black 配置数据模式
   *
   * 定义黑名单配置的数据结构。
   */
  const Schema = z.object({
    // 固定限制（整数）
    fixedLimit: z.number().int(),
    // 滚动限制（整数）
    rollingLimit: z.number().int(),
    // 滚动窗口时长，单位：秒（整数）
    rollingWindow: z.number().int(),
  })

  /**
   * 验证黑名单数据
   *
   * 验证传入的数据是否符合 Black 配置的模式。
   *
   * @param input - 要验证的黑名单配置数据
   * @returns 验证通过的数据
   *
   * @example
   * ```typescript
   * const validated = await BlackData.validate({
   *   fixedLimit: 100,
   *   rollingLimit: 50,
   *   rollingWindow: 60,
   * })
   * ```
   */
  export const validate = fn(Schema, (input) => {
    // 返回验证后的数据
    return input
  })

  /**
   * 获取黑名单配置
   *
   * 从资源中获取并解析 Black 配置。
   *
   * @returns Black 配置对象
   *
   * @example
   * ```typescript
   * const blackConfig = await BlackData.get()
   * console.log(blackConfig.fixedLimit)    // 固定限制值
   * console.log(blackConfig.rollingLimit)  // 滚动限制值
   * console.log(blackConfig.rollingWindow) // 滚动窗口时长
   * ```
   */
  export const get = fn(z.void(), () => {
    // 从资源获取 Black 配置 JSON 字符串并解析
    const json = JSON.parse(Resource.ZEN_BLACK.value)
    // 验证并返回解析后的配置
    return Schema.parse(json)
  })
}
