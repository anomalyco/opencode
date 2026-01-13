/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/auth
 * ============================================================================
 *
 * 文件作用：
 * 认证信息存储模块。管理 AI 提供商的认证凭证（OAuth、API Key 等）。
 *
 * 主要功能：
 * - OAuth 认证信息存储（refresh token、access token）
 * - API Key 存储
 * - WellKnown 认证存储
 * - 持久化存储到 auth.json
 * - 文件权限保护（0600）
 *
 * 依赖关系：
 * - path：Node.js 路径处理模块
 * - ../global：全局路径配置
 * - fs/promises：异步文件操作
 * - zod：运行时类型验证
 *
 * 导出内容：
 * - Auth namespace：认证命名空间
 *   - OAUTH_DUMMY_KEY：OAuth 虚拟键常量
 *   - Oauth Schema：OAuth 认证信息类型
 *   - Api Schema：API Key 类型
 *   - WellKnown Schema：WellKnown 认证类型
 *   - Info Schema：联合认证类型
 *   - get(providerID)：获取指定提供商的认证信息
 *   - all()：获取所有认证信息
 *   - set(key, info)：设置认证信息
 *   - remove(key)：删除认证信息
 *
 * 认证类型：
 * 1. OAuth：使用 OAuth 2.0 流程的认证
 *    - 包含 refresh token、access token、过期时间等
 * 2. Api：使用 API Key 的认证
 *    - 只包含密钥字符串
 * 3. WellKnown：特殊的预定义认证
 *    - 包含键和 token
 *
 * 文件存储：
 * - 路径：{data}/auth.json
 * - 格式：JSON
 * - 权限：0600（仅所有者可读写）
 * - 内容：{ [providerID]: Info }
 *
 * 使用场景：
 * - 存储 Anthropic API Key
 * - 存储 GitHub OAuth token
 * - 存储自定义提供商的认证信息
 *
 * 使用示例：
 * ```typescript
 * // 获取所有认证信息
 * const auths = await Auth.all()
 * // { "anthropic": { type: "api", key: "sk-ant-..." } }
 *
 * // 获取指定提供商的认证
 * const anthropic = await Auth.get("anthropic")
 *
 * // 设置 API Key
 * await Auth.set("openai", {
 *   type: "api",
 *   key: "sk-..."
 * })
 *
 * // 设置 OAuth 认证
 * await Auth.set("github", {
 *   type: "oauth",
 *   refresh: "ghr_...",
 *   access: "ghu_...",
 *   expires: Date.now() + 3600000,
 *   accountId: "user123"
 * })
 *
 * // 删除认证信息
 * await Auth.remove("old-provider")
 * ```
 *
 * 安全性：
 * - 文件权限设置为 0600（仅所有者可读写）
 * - 敏感信息（token、key）存储在本地
 * - 不记录日志以防止泄露
 *
 * @package opencode
 * @module auth
 */

// 导入 Node.js 路径处理模块
import path from "path"

// 导入全局路径配置
import { Global } from "../global"

// 导入异步文件操作模块
import fs from "fs/promises"

// 导入 Zod 类型验证库
import z from "zod"

/**
 * OAuth 虚拟键常量
 *
 * 用于标识 OAuth 认证的虚拟键。
 * 当没有实际的 API Key 时使用此键作为占位符。
 */
export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

/**
 * 认证命名空间
 *
 * 提供认证信息的存储和管理功能。
 */
export namespace Auth {
  /**
   * OAuth 认证信息 Schema
   *
   * 定义使用 OAuth 2.0 流程的认证信息结构。
   *
   * 字段说明：
   * - type：固定为 "oauth"，标识认证类型
   * - refresh：OAuth refresh token，用于获取新的 access token
   * - access：OAuth access token，用于 API 认证
   * - expires：access token 过期时间戳（毫秒）
   * - accountId：（可选）用户账户 ID
   * - enterpriseUrl：（可选）企业版 URL
   */
  export const Oauth = z
    .object({
      type: z.literal("oauth"),        // 认证类型标识
      refresh: z.string(),              // Refresh token
      access: z.string(),               // Access token
      expires: z.number(),              // 过期时间戳
      accountId: z.string().optional(), // 可选的用户 ID
      enterpriseUrl: z.string().optional(), // 可选的企业 URL
    })
    .meta({ ref: "OAuth" })             // 元数据，用于类型引用

  /**
   * API Key 认证 Schema
   *
   * 定义使用 API Key 的认证信息结构。
   *
   * 字段说明：
   * - type：固定为 "api"，标识认证类型
   * - key：API Key 字符串
   */
  export const Api = z
    .object({
      type: z.literal("api"),  // 认证类型标识
      key: z.string(),         // API Key
    })
    .meta({ ref: "ApiAuth" })  // 元数据，用于类型引用

  /**
   * WellKnown 认证 Schema
   *
   * 定义预定义的认证信息结构。
   * 用于已知的、预先配置的认证方式。
   *
   * 字段说明：
   * - type：固定为 "wellknown"，标识认证类型
   * - key：认证键
   * - token：认证令牌
   */
  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),  // 认证类型标识
      key: z.string(),               // 认证键
      token: z.string(),             // 认证令牌
    })
    .meta({ ref: "WellKnownAuth" })  // 元数据，用于类型引用

  /**
   * 联合认证信息 Schema
   *
   * 使用 discriminatedUnion 根据 type 字段区分不同认证类型。
   * 这是 Info 类型的基础定义。
   */
  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })

  /**
   * 认证信息类型
   *
   * 从 Info Schema 推断出的 TypeScript 类型。
   * 包含所有可能的认证信息形状。
   */
  export type Info = z.infer<typeof Info>

  /**
   * 认证文件路径
   *
   * 存储在全局数据目录下的 auth.json 文件。
   */
  const filepath = path.join(Global.Path.data, "auth.json")

  /**
   * 获取指定提供商的认证信息
   *
   * 从存储中读取指定提供商 ID 的认证信息。
   *
   * @param providerID - 提供商 ID（如 "anthropic", "openai"）
   * @returns 认证信息对象，如果不存在返回 undefined
   *
   * @example
   * ```typescript
   * const auth = await Auth.get("anthropic")
   * if (auth) {
   *   console.log(auth.type)  // "api"
   *   console.log(auth.key)   // "sk-ant-..."
   * }
   * ```
   */
  export async function get(providerID: string) {
    // 获取所有认证信息
    const auth = await all()
    // 返回指定提供商的信息
    return auth[providerID]
  }

  /**
   * 获取所有认证信息
   *
   * 从 auth.json 文件读取并解析所有认证信息。
   *
   * @returns Promise，解析为提供商 ID 到认证信息的映射
   *
   * 处理流程：
   * 1. 读取 auth.json 文件
   * 2. 解析 JSON（失败则返回空对象）
   * 3. 使用 Zod 验证每个条目
   * 4. 过滤掉无效的条目
   * 5. 返回验证通过的条目
   *
   * @example
   * ```typescript
   * const auths = await Auth.all()
   * // {
   * //   "anthropic": { type: "api", key: "sk-ant-..." },
   * //   "github": { type: "oauth", refresh: "...", ... }
   * // }
   * ```
   */
  export async function all(): Promise<Record<string, Info>> {
    // 使用 Bun 读取文件
    const file = Bun.file(filepath)

    // 解析 JSON，失败则返回空对象
    const data = await file.json().catch(() => ({}) as Record<string, unknown>)

    // 遍历所有条目，验证并过滤
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        // 使用 Zod 验证认证信息
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc  // 无效则跳过
        acc[key] = parsed.data  // 有效则添加
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  /**
   * 设置认证信息
   *
   * 将认证信息保存到 auth.json 文件。
   *
   * @param key - 提供商 ID
   * @param info - 认证信息对象
   * @returns Promise，保存完成时 resolve
   *
   * 处理流程：
   * 1. 读取现有所有认证信息
   * 2. 添加或更新指定键的认证信息
   * 3. 写入文件（格式化 JSON，缩进 2 空格）
   * 4. 设置文件权限为 0600（仅所有者可读写）
   *
   * 安全性：
   * - 文件权限 0600 确保只有所有者可读写
   * - 防止其他用户读取敏感信息
   *
   * @example
   * ```typescript
   * await Auth.set("anthropic", {
   *   type: "api",
   *   key: "sk-ant-..."
   * })
   * ```
   */
  export async function set(key: string, info: Info) {
    // 获取文件对象
    const file = Bun.file(filepath)

    // 读取现有数据
    const data = await all()

    // 写入更新后的数据
    await Bun.write(file, JSON.stringify({ ...data, [key]: info }, null, 2))

    // 设置文件权限为 0600（仅所有者可读写）
    await fs.chmod(file.name!, 0o600)
  }

  /**
   * 删除认证信息
   *
   * 从 auth.json 文件中删除指定提供商的认证信息。
   *
   * @param key - 要删除的提供商 ID
   * @returns Promise，删除完成时 resolve
   *
   * 处理流程：
   * 1. 读取现有所有认证信息
   * 2. 删除指定键
   * 3. 写入更新后的数据
   * 4. 设置文件权限为 0600
   *
   * @example
   * ```typescript
   * await Auth.remove("old-provider")
   * ```
   */
  export async function remove(key: string) {
    // 获取文件对象
    const file = Bun.file(filepath)

    // 读取现有数据
    const data = await all()

    // 删除指定键
    delete data[key]

    // 写入更新后的数据
    await Bun.write(file, JSON.stringify(data, null, 2))

    // 设置文件权限为 0600
    await fs.chmod(file.name!, 0o600)
  }
}
