/**
 * ============================================================================
 * 文件名：identifier.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * 唯一标识符生成模块。生成带前缀的 ULID 格式 ID。
 *
 * 主要功能：
 * - 为不同类型的实体生成唯一 ID
 * - 验证 ID 格式
 * - 支持 ID 前缀校验
 *
 * 依赖关系：
 * - ulid：ULID 生成库
 * - zod：运行时类型验证
 *
 * 导出内容：
 * - Identifier.create：创建带前缀的 ID
 * - Identifier.schema：创建 ID 验证 schema
 *
 * 使用场景：
 * - 数据库记录 ID 生成
 * - API 参数验证
 *
 * ID 格式说明：
 * 格式：{prefix}_{ulid}
 * 示例：acc_01ARZ3NDEKTSV4RRFFQ69G5FAV
 *
 * 前缀列表：
 * - acc：账户（account）
 * - aut：认证（auth）
 * - ben：基准测试（benchmark）
 * - bil：账单（billing）
 * - key：API 密钥（key）
 * - mod：模型（model）
 * - pay：支付（payment）
 * - prv：提供商（provider）
 * - sub：订阅（subscription）
 * - usg：使用情况（usage）
 * - usr：用户（user）
 * - wrk：工作区（workspace）
 *
 * @package console.core
 * @module identifier
 */

// 导入 ULID 生成库
// ULID 是时间排序的唯一标识符，类似 UUID 但按时间排序
import { ulid } from "ulid"

// 导入 Zod 类型验证库
import { z } from "zod"

/**
 * Identifier 命名空间
 *
 * 包含所有 ID 生成和验证相关的功能。
 */
export namespace Identifier {
  /**
   * 实体类型前缀映射
   *
   * 定义每种实体类型的 ID 前缀。
   * 使用 const 断言确保类型安全。
   */
  const prefixes = {
    // 账户前缀
    account: "acc",
    // 认证记录前缀
    auth: "aut",
    // 基准测试前缀
    benchmark: "ben",
    // 账单前缀
    billing: "bil",
    // API 密钥前缀
    key: "key",
    // 模型前缀
    model: "mod",
    // 支付前缀
    payment: "pay",
    // 提供商前缀
    provider: "prv",
    // 订阅前缀
    subscription: "sub",
    // 使用情况前缀
    usage: "usg",
    // 用户前缀
    user: "usr",
    // 工作区前缀
    workspace: "wrk",
  } as const

  /**
   * 创建带前缀的唯一 ID
   *
   * 生成格式为 {prefix}_{ulid} 的唯一标识符。
   *
   * @param prefix - 实体类型前缀
   * @param given - 可选的已存在 ID，用于验证而不是生成
   * @returns 带前缀的唯一 ID
   * @throws 如果给定的 ID 前缀不匹配
   *
   * @example
   * ```typescript
   * // 生成新的账户 ID
   * const accountID = Identifier.create("account")
   * // 返回类似 "acc_01ARZ3NDEKTSV4RRFFQ69G5FAV"
   *
   * // 验证现有 ID
   * const validated = Identifier.create("account", "acc_01ARZ3NDEKTSV4RRFFQ69G5FAV")
   * // 返回原始 ID
   *
   * // 前缀不匹配会抛出错误
   * Identifier.create("account", "usr_01ARZ3NDEKTSV4RRFFQ69G5FAV")
   * // throws Error: ID usr_01ARZ3NDEKTSV4RRFFQ69G5FAV does not start with acc
   * ```
   */
  export function create(prefix: keyof typeof prefixes, given?: string): string {
    // 如果提供了现有 ID，进行验证
    if (given) {
      // 检查 ID 是否以正确的前缀开头
      if (given.startsWith(prefixes[prefix])) return given

      // 前缀不匹配，抛出错误
      throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
    }

    // 生成新的 ULID 并与前缀拼接
    // 格式：{prefix}_{ulid}
    return [prefixes[prefix], ulid()].join("_")
  }

  /**
   * 创建 ID 验证 Schema
   *
   * 创建一个 Zod schema，用于验证字符串是否以指定前缀开头。
   *
   * @param prefix - 实体类型前缀
   * @returns Zod schema
   *
   * @example
   * ```typescript
   * // 创建账户 ID 验证 schema
   * const AccountIDSchema = Identifier.schema("account")
   *
   * // 验证 ID
   * AccountIDSchema.parse("acc_01ARZ3NDEKTSV4RRFFQ69G5FAV") // OK
   * AccountIDSchema.parse("usr_01ARZ3NDEKTSV4RRFFQ69G5FAV") // throws ZodError
   * ```
   */
  export function schema(prefix: keyof typeof prefixes) {
    // 创建字符串验证 schema
    // 检查字符串是否以指定前缀开头
    return z.string().startsWith(prefixes[prefix])
  }
}
