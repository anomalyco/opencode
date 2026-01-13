/**
 * ============================================================================
 * 文件名：resource.node.ts
 * 所属包：packages/console/resource
 * ============================================================================
 *
 * 文件作用：
 * Node.js 环境下的资源访问模块。
 * 在本地开发时提供与 Cloudflare Workers 兼容的资源访问接口。
 *
 * 主要功能：
 * - 访问 SST 资源（通过 sst 包）
 * - 提供 R2 Bucket 的本地模拟（空实现）
 * - 提供 KV 命名空间的完整实现（通过 Cloudflare API）
 *
 * 依赖关系：
 * - @cloudflare/workers-types：Cloudflare Workers 类型定义
 * - sst：SST 框架核心
 * - cloudflare：Cloudflare API 客户端
 *
 * 导出内容：
 * - Resource：资源访问代理对象
 * - waitUntil：空实现的延迟任务函数
 *
 * 使用场景：
 * - 本地开发时访问 SST 链接的资源
 * - 与 Cloudflare Workers 环境保持一致的接口
 *
 * @package console.resource
 * @module node
 */

// 导入 Cloudflare KV 类型定义
// KVNamespaceListOptions：KV 列表查询选项
// KVNamespaceListResult：KV 列表查询结果
// KVNamespacePutOptions：KV 写入选项
import type { KVNamespaceListOptions, KVNamespaceListResult, KVNamespacePutOptions } from "@cloudflare/workers-types"

// 导入 SST 资源基类
// ResourceBase 包含所有 SST 资源的定义和值
import { Resource as ResourceBase } from "sst"

// 导入 Cloudflare SDK
// 用于在本地环境访问 Cloudflare KV 服务
import Cloudflare from "cloudflare"

/**
 * waitUntil 函数
 *
 * Node.js 环境下的空实现。
 * 在 Cloudflare Workers 中，此函数用于将任务推迟到主响应完成后执行。
 * 在 Node.js 中，直接 await 即可，不需要特殊处理。
 *
 * @param promise - 要等待的 Promise
 */
export const waitUntil = async (promise: Promise<any>) => {
  // 直接等待 Promise 完成
  await promise
}

/**
 * 资源访问代理对象
 *
 * 使用 Proxy 实现动态属性访问。
 * 在 Node.js 环境下模拟 Cloudflare Workers 的资源访问行为。
 *
 * 工作原理：
 * 1. 拦截属性访问（get 操作）
 * 2. 从 ResourceBase 获取资源定义
 * 3. 根据资源类型返回相应的实现：
 *    - Bucket：返回空实现（本地开发不需要 R2）
 *    - Kv：返回通过 Cloudflare API 访问的 KV 客户端
 *    - 其他：直接返回资源值
 *
 * @example
 * ```typescript
 * // 访问 KV 存储
 * const kv = Resource.MyKv
 * await kv.put("key", "value")
 * const value = await kv.get("key")
 * ```
 */
export const Resource = new Proxy(
  // 目标对象为空，所有操作由 Proxy 处理
  {},
  {
    /**
     * 属性访问拦截器
     *
     * @param _target - 目标对象（此处为空对象）
     * @param prop - 访问的属性名（资源名称）
     * @returns 资源实例或模拟实现
     */
    get(_target, prop: keyof typeof ResourceBase) {
      // 从 ResourceBase 获取资源定义
      const value = ResourceBase[prop]

      // 检查是否有 type 属性（表示这是 SST 资源）
      if ("type" in value) {
        // @ts-ignore - type 属性是动态的
        const resourceType = value.type

        // 处理 R2 Bucket 资源
        // @ts-ignore
        if (resourceType === "sst.cloudflare.Bucket") {
          // 返回空实现
          // 本地开发时不需要真实的 R2 存储
          // put 操作不做任何事情，避免错误
          return {
            put: async () => {},
          }
        }

        // 处理 KV 命名空间资源
        // @ts-ignore
        if (resourceType === "sst.cloudflare.Kv") {
          // 创建 Cloudflare API 客户端
          // 需要提供 API Token 进行认证
          const client = new Cloudflare({
            // 从 SST 资源中获取 Cloudflare API Token
            apiToken: ResourceBase.CLOUDFLARE_API_TOKEN.value,
          })

          // @ts-ignore - namespaceId 是动态属性
          // 获取 KV 命名空间 ID
          const namespaceId = value.namespaceId

          // 获取 Cloudflare 账户 ID
          const accountId = ResourceBase.CLOUDFLARE_DEFAULT_ACCOUNT_ID.value

          // 返回 KV 命名空间接口
          // 提供与 Cloudflare Workers KV 相同的 API
          return {
            /**
             * 获取 KV 值
             *
             * @param k - 键（字符串或字符串数组）
             * @returns 单个值或 Map（批量获取）
             */
            get: (k: string | string[]) => {
              // 检查是否为批量获取
              const isMulti = Array.isArray(k)

              // 调用 Cloudflare API 批量获取
              return client.kv.namespaces
                .bulkGet(namespaceId, {
                  // 确保 keys 是数组格式
                  keys: Array.isArray(k) ? k : [k],
                  // 提供账户 ID
                  account_id: accountId,
                })
                .then((result) => {
                  // 批量获取：返回 Map
                  if (isMulti) return new Map(Object.entries(result?.values ?? {}))
                  // 单个获取：返回对应键的值
                  return result?.values?.[k]
                })
            },

            /**
             * 写入 KV 值
             *
             * @param k - 键
             * @param v - 值（字符串）
             * @param opts - 写入选项（过期时间、元数据等）
             */
            put: (k: string, v: string, opts?: KVNamespacePutOptions) =>
              client.kv.namespaces.values.update(namespaceId, k, {
                // 提供账户 ID
                account_id: accountId,
                // 值
                value: v,
                // 绝对过期时间（时间戳）
                expiration: opts?.expiration,
                // 相对过期时间（秒）
                expiration_ttl: opts?.expirationTtl,
                // 元数据
                metadata: opts?.metadata,
              }),

            /**
             * 删除 KV 值
             *
             * @param k - 要删除的键
             */
            delete: (k: string) =>
              client.kv.namespaces.values.delete(namespaceId, k, {
                // 提供账户 ID
                account_id: accountId,
              }),

            /**
             * 列出 KV 键
             *
             * @param opts - 列表选项（前缀、限制等）
             * @returns 键列表和元数据
             */
            list: (opts?: KVNamespaceListOptions): Promise<KVNamespaceListResult<unknown, string>> =>
              client.kv.namespaces.keys
                .list(namespaceId, {
                  // 提供账户 ID
                  account_id: accountId,
                  // 键前缀过滤
                  prefix: opts?.prefix ?? undefined,
                })
                .then((result) => {
                  // 返回标准格式的结果
                  return {
                    // 键列表
                    keys: result.result,
                    // 列表是否完整（本地总是完整）
                    list_complete: true,
                    // 缓存状态（本地无缓存）
                    cacheStatus: null,
                  }
                }),
          }
        }
      }

      // 非 SST 资源，直接返回值
      return value
    },
  },
) as Record<string, any>
