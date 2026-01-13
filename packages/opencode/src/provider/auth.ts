/**
 * ============================================================================
 * 文件名：auth.ts
 * 所属包：packages/opencode/src/provider
 * ============================================================================
 *
 * 文件作用：
 * AI 提供商认证管理模块。处理插件提供的 AI 服务商的 OAuth 认证流程和 API Key 设置。
 *
 * 主要功能：
 * - Method：认证方法类型定义（OAuth 或 API Key）
 * - Authorization：授权信息接口定义
 * - methods()：获取所有可用的认证方法
 * - authorize(input)：发起认证请求
 * - callback(input)：处理 OAuth 回调
 * - api(input)：直接设置 API Key
 *
 * 依赖关系：
 * - ../project/instance：实例级状态管理
 * - ../plugin：插件系统，获取提供认证的插件
 * - ../auth：认证信息存储
 * - ../util/fn：函数包装工具
 * - ../util/error：命名错误定义
 *
 * 导出内容：
 * - ProviderAuth namespace：提供商认证命名空间
 *   - Method：认证方法 Schema
 *   - Authorization：授权信息 Schema
 *   - methods()：获取可用认证方法
 *   - authorize()：发起认证
 *   - callback()：处理 OAuth 回调
 *   - api()：设置 API Key
 *   - OauthMissing：OAuth 缺失错误
 *   - OauthCodeMissing：OAuth Code 缺失错误
 *   - OauthCallbackFailed：OAuth 回调失败错误
 *
 * 认证流程：
 * 1. 插件通过 auth.provider 声明支持的认证方法
 * 2. 用户选择提供商和方法后调用 authorize()
 * 3. 如果是 OAuth，用户完成授权后调用 callback()
 * 4. 认证成功后保存到 Auth 存储
 *
 * OAuth vs API Key：
 * - OAuth：需要用户授权跳转，返回 access/refresh token
 * - API Key：用户直接输入密钥，存储为 api 类型
 *
 * 使用示例：
 * ```typescript
 * // 获取所有提供商的认证方法
 * const methods = await ProviderAuth.methods()
 * // { "openai": [{ type: "oauth", label: "OpenAI OAuth" }] }
 *
 * // 发起 OAuth 认证
 * const auth = await ProviderAuth.authorize({
 *   providerID: "openai",
 *   method: 0
 * })
 * // 返回：{ url: "...", method: "code", instructions: "..." }
 *
 * // 处理 OAuth 回调
 * await ProviderAuth.callback({
 *   providerID: "openai",
 *   method: 0,
 *   code: "auth_code_here"
 * })
 *
 * // 直接设置 API Key
 * await ProviderAuth.api({
 *   providerID: "openai",
 *   key: "sk-..."
 * })
 * ```
 *
 * @package opencode
 * @module provider/auth
 */

// 导入实例状态管理，用于缓存认证状态
import { Instance } from "@/project/instance"

// 导入插件系统，获取提供认证的插件
import { Plugin } from "../plugin"

// 导入 remeda 工具函数
import { map, filter, pipe, fromEntries, mapValues } from "remeda"

// 导入 Zod 用于运行时类型验证
import z from "zod"

// 导入函数包装工具
import { fn } from "@/util/fn"

// 导入插件 SDK 类型
import type { AuthOuathResult, Hooks } from "@opencode-ai/plugin"

// 导入命名错误工具
import { NamedError } from "@opencode-ai/util/error"

// 导入认证存储模块
import { Auth } from "@/auth"

/**
 * 提供商认证命名空间
 *
 * 管理来自插件的 AI 提供商认证流程。
 */
export namespace ProviderAuth {
  // 实例级状态，用于存储认证方法和待处理的 OAuth 流程
  const state = Instance.state(async () => {
    // 使用 remeda 的 pipe 进行数据流转换
    const methods = pipe(
      // 获取所有插件列表
      await Plugin.list(),
      // 过滤出提供认证的插件
      filter((x) => x.auth?.provider !== undefined),
      // 将每个插件的认证信息转换为 [providerID, auth] 键值对
      map((x) => [x.auth!.provider, x.auth!] as const),
      // 转换为对象
      fromEntries(),
    )
    // 返回状态对象：methods 是所有认证方法，pending 是待处理的 OAuth 流程
    return { methods, pending: {} as Record<string, AuthOuathResult> }
  })

  /**
   * 认证方法 Schema
   *
   * 定义单个认证方法的结构。
   */
  export const Method = z
    .object({
      // 认证类型：oauth（需要用户授权）或 api（直接输入密钥）
      type: z.union([z.literal("oauth"), z.literal("api")]),
      // 方法显示名称
      label: z.string(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  /**
   * 获取所有可用的认证方法
   *
   * 返回所有提供商及其支持的认证方法列表。
   *
   * @returns Promise，解析为提供商 ID 到认证方法数组的映射
   *
   * @example
   * ```typescript
   * const methods = await ProviderAuth.methods()
   * // {
   * //   "openai": [
   * //     { type: "oauth", label: "OpenAI OAuth" },
   * //     { type: "api", label: "API Key" }
   * //   ],
   * //   "anthropic": [{ type: "api", label: "API Key" }]
   * // }
   * ```
   */
  export async function methods() {
    // 获取状态中的 methods
    const s = await state().then((x) => x.methods)
    // 将每个提供商的认证方法转换为标准格式
    return mapValues(s, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
        }),
      ),
    )
  }

  /**
   * 授权信息 Schema
   *
   * 定义 OAuth 授权流程的返回信息。
   */
  export const Authorization = z
    .object({
      // 授权 URL，用户需要访问此 URL 完成授权
      url: z.string(),
      // 认证方法：auto（自动完成）或 code（需要手动输入授权码）
      method: z.union([z.literal("auto"), z.literal("code")]),
      // 授权说明文字
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  /**
   * 发起认证请求
   *
   * 为指定的提供商和方法发起认证流程。
   *
   * @param input - 认证参数
   *   - providerID：提供商 ID
   *   - method：认证方法索引
   * @returns Promise，解析为授权信息（仅 OAuth 类型返回）
   *
   * 认证流程：
   * 1. 查找提供商的认证方法
   * 2. 如果是 OAuth，调用插件的 authorize() 函数
   * 3. 将 OAuth 结果存储到 pending 状态
   * 4. 返回授权信息给用户
   *
   * @example
   * ```typescript
   * const auth = await ProviderAuth.authorize({
   *   providerID: "openai",
   *   method: 0
   * })
   * // 显示 auth.url 给用户，等待用户完成授权
   * ```
   */
  export const authorize = fn(
    z.object({
      // 提供商 ID
      providerID: z.string(),
      // 认证方法索引（从 methods() 返回的数组中选择）
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> => {
      // 获取指定提供商的认证配置
      const auth = await state().then((s) => s.methods[input.providerID])
      // 获取指定的认证方法
      const method = auth.methods[input.method]
      // 只处理 OAuth 类型的认证
      if (method.type === "oauth") {
        // 调用插件的 authorize 函数发起 OAuth 流程
        const result = await method.authorize()
        // 将 OAuth 结果存储到 pending 状态，等待 callback 处理
        await state().then((s) => (s.pending[input.providerID] = result))
        // 返回授权信息
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      }
    },
  )

  /**
   * 处理 OAuth 回调
   *
   * 完成 OAuth 认证流程，保存认证信息到存储。
   *
   * @param input - 回调参数
   *   - providerID：提供商 ID
   *   - method：认证方法索引
   *   - code：可选的授权码（method 为 "code" 时需要）
   * @returns Promise，完成时认证信息已保存
   *
   * 处理流程：
   * 1. 从 pending 状态获取 OAuth 结果
   * 2. 根据方法类型调用 callback：
   *    - code：使用授权码调用 callback
   *    - auto：直接调用 callback
   * 3. 保存认证信息到 Auth 存储：
   *    - key 类型：保存 API Key
   *    - refresh 类型：保存 access/refresh token
   *
   * @example
   * ```typescript
   * // code 模式
   * await ProviderAuth.callback({
   *   providerID: "openai",
   *   method: 0,
   *   code: "auth_code_from_user"
   * })
   *
   * // auto 模式
   * await ProviderAuth.callback({
   *   providerID: "openai",
   *   method: 0
   * })
   * ```
   */
  export const callback = fn(
    z.object({
      // 提供商 ID
      providerID: z.string(),
      // 认证方法索引
      method: z.number(),
      // 授权码（code 模式需要）
      code: z.string().optional(),
    }),
    async (input) => {
      // 从 pending 状态获取 OAuth 流程结果
      const match = await state().then((s) => s.pending[input.providerID])
      // 如果没有找到待处理的 OAuth 流程，抛出错误
      if (!match) throw new OauthMissing({ providerID: input.providerID })
      let result

      // 处理 code 模式：需要授权码
      if (match.method === "code") {
        if (!input.code) throw new OauthCodeMissing({ providerID: input.providerID })
        // 使用授权码调用 callback
        result = await match.callback(input.code)
      }

      // 处理 auto 模式：自动完成
      if (match.method === "auto") {
        // 直接调用 callback
        result = await match.callback()
      }

      // 处理认证成功的结果
      if (result?.type === "success") {
        // 如果返回的是 API Key
        if ("key" in result) {
          await Auth.set(input.providerID, {
            type: "api",
            key: result.key,
          })
        }
        // 如果返回的是 OAuth token
        if ("refresh" in result) {
          // 构造 OAuth 认证信息
          const info: Auth.Info = {
            type: "oauth",
            access: result.access,
            refresh: result.refresh,
            expires: result.expires,
          }
          // 如果有账户 ID，添加到认证信息
          if (result.accountId) {
            info.accountId = result.accountId
          }
          // 保存 OAuth 认证信息
          await Auth.set(input.providerID, info)
        }
        return
      }

      // 认证失败，抛出错误
      throw new OauthCallbackFailed({})
    },
  )

  /**
   * 直接设置 API Key
   *
   * 允许用户直接输入 API Key 而不通过 OAuth 流程。
   *
   * @param input - API Key 参数
   *   - providerID：提供商 ID
   *   - key：API Key 字符串
   * @returns Promise，完成时 API Key 已保存
   *
   * @example
   * ```typescript
   * await ProviderAuth.api({
   *   providerID: "anthropic",
   *   key: "sk-ant-..."
   * })
   * ```
   */
  export const api = fn(
    z.object({
      // 提供商 ID
      providerID: z.string(),
      // API Key 字符串
      key: z.string(),
    }),
    async (input) => {
      // 直接保存 API Key 类型的认证信息
      await Auth.set(input.providerID, {
        type: "api",
        key: input.key,
      })
    },
  )

  /**
   * OAuth 流程未找到错误
   *
   * 当 callback 被调用但没有找到对应的 pending OAuth 流程时抛出。
   */
  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  /**
   * OAuth 授权码缺失错误
   *
   * 当 method 是 "code" 但没有提供授权码时抛出。
   */
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  /**
   * OAuth 回调失败错误
   *
   * 当 OAuth callback 返回非 success 结果时抛出。
   */
  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
}
