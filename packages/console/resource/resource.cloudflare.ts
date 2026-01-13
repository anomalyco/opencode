/**
 * ============================================================================
 * 文件名：resource.cloudflare.ts
 * 所属包：packages/console/resource
 * ============================================================================
 *
 * 文件作用：
 * Cloudflare Workers 环境下的资源访问模块。
 * 通过 Proxy 动态获取 SST 链接的资源。
 *
 * 主要功能：
 * - 访问 Cloudflare Workers 环境变量
 * - 自动解析 JSON 字符串
 * - 提供统一的资源访问接口
 *
 * 依赖关系：
 * - cloudflare:workers：Cloudflare Workers 环境类型
 *
 * 导出内容：
 * - Resource：资源访问代理对象
 * - waitUntil：延迟任务处理函数
 *
 * 使用场景：
 * - 在 Cloudflare Workers 中访问 SST 链接的资源
 * - 获取 R2、KV、D1 等绑定资源
 *
 * @package console.resource
 * @module cloudflare
 */

// 从 Cloudflare Workers 导入环境变量
// env 包含所有在 sst.config.ts 中绑定的资源
import { env } from "cloudflare:workers"

// 导出 waitUntil 函数
// 用于将任务推迟到主响应完成后执行
export { waitUntil } from "cloudflare:workers"

/**
 * 资源访问代理对象
 *
 * 使用 Proxy 实现动态属性访问。
 * 当访问 Resource.xxx 时，会从 env 中获取对应的资源。
 *
 * 工作原理：
 * 1. 拦截属性访问（get 操作）
 * 2. 检查 env 中是否存在该属性
 * 3. 如果值是 JSON 字符串，自动解析
 * 4. 如果属性名是 "App"，从 SST_RESOURCE_App 读取
 * 5. 如果资源不存在，抛出错误提示
 *
 * @example
 * ```typescript
 * // 假设在 sst.config.ts 中绑定了：
 * // bind: [(Bucket as "MyBucket").name("MyBucket")]
 *
 * const bucket = Resource.MyBucket
 * // bucket 就是 R2 Bucket 实例
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
     * @returns 资源实例或解析后的值
     * @throws 如果资源未链接，抛出错误
     */
    get(_target, prop: string) {
      // 检查环境变量中是否存在该资源
      // SST 会将绑定的资源注入到 env 中
      if (prop in env) {
        // @ts-expect-error - 动态访问，TypeScript 无法推断
        const value = env[prop]

        // 如果值是字符串，尝试解析为 JSON
        // SST 会将某些资源配置序列化为 JSON 字符串
        return typeof value === "string" ? JSON.parse(value) : value
      }

      // 特殊处理：访问 "App" 属性
      // App 是 SST 应用本身，存储在 SST_RESOURCE_App 中
      else if (prop === "App") {
        // @ts-expect-error - 动态访问，TypeScript 无法推断
        return JSON.parse(env.SST_RESOURCE_App)
      }

      // 资源不存在，抛出友好的错误信息
      // 提示用户需要在 sst.config.ts 中链接该资源
      throw new Error(`"${prop}" is not linked in your sst.config.ts (cloudflare)`)
    },
  },
) as Record<string, any>
