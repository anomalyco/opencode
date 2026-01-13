/**
 * ============================================================================
 * 文件名：client.ts
 * 所属包：packages/sdk/js/src/v2
 * ============================================================================
 *
 * 文件作用：
 * OpenCode SDK V2 版本的客户端模块。
 * 提供创建 OpenCode 客户端的功能，用于与 OpenCode 服务器进行通信。
 *
 * 主要功能：
 * - 创建配置好的 HTTP 客户端
 * - 自动设置请求超时为禁用（避免长时间请求被中断）
 * - 支持设置目录头（用于指定工作目录）
 * - 对非 ASCII 目录路径进行 URL 编码
 *
 * 依赖关系：
 * - gen/client/client.gen.js：自动生成的客户端核心
 * - gen/client/types.gen.js：类型定义
 * - gen/sdk.gen.js：SDK 包装类
 *
 * 导出内容：
 * - createOpencodeClient：创建 OpenCode V2 客户端的函数
 * - OpencodeClient：OpenCode V2 客户端类
 * - OpencodeClientConfig：客户端配置类型
 *
 * 使用场景：
 * - 与 OpenCode 服务器进行 HTTP 通信
 * - 调用 OpenCode V2 API
 * - 集成 OpenCode 功能到应用中
 *
 * @package sdk/js
 * @module v2/client
 */

// 重新导出生成的类型定义
// 这包含所有 API 的类型定义
export * from "./gen/types.gen.js"

// 导入自动生成的客户端创建函数
// 这是基于 OpenAPI 规范生成的客户端核心
import { createClient } from "./gen/client/client.gen.js"

// 导入客户端配置类型
import { type Config } from "./gen/client/types.gen.js"

// 导入 OpenCode 客户端类
// 这是一个包装了生成客户端的高级 API
import { OpencodeClient } from "./gen/sdk.gen.js"

// 导出配置类型为 OpencodeClientConfig，提供更清晰的类型名
export { type Config as OpencodeClientConfig, OpencodeClient }

/**
 * 创建 OpenCode V2 客户端
 *
 * 创建一个配置好的 OpenCode V2 客户端实例，用于与 OpenCode 服务器通信。
 *
 * @param config - 客户端配置选项
 * @returns OpenCode V2 客户端实例
 *
 * 配置处理：
 * 1. 如果未提供 fetch 函数，创建自定义 fetch：
 *    - 禁用请求超时（避免长时间 AI 请求被中断）
 * 2. 如果提供了 directory 选项：
 *    - 检查是否包含非 ASCII 字符
 *    - 如果有非 ASCII 字符，进行 URL 编码
 *    - 将目录路径添加到请求头
 * 3. 创建底层客户端并包装为 OpencodeClient
 *
 * 与 V1 的区别：
 * - V2 版本对非 ASCII 目录路径进行 URL 编码
 * - 这确保包含中文、日文等多字节字符的路径能正确传输
 *
 * 使用场景：
 * - 连接到 OpenCode V2 服务器
 * - 调用会话、文件、Agent 等 API
 * - 集成到 Web 应用或 Node.js 服务
 *
 * @example
 * ```typescript
 * import { createOpencodeClient } from "@opencode-ai/sdk/v2"
 *
 * // 创建连接到本地服务器的客户端
 * const client = createOpencodeClient({
 *   baseUrl: "http://localhost:4096",
 * })
 *
 * // 创建带目录的客户端（支持非 ASCII 路径）
 * const clientWithDir = createOpencodeClient({
 *   baseUrl: "http://localhost:4096",
 *   directory: "/路径/到/项目", // 中文路径会被自动编码
 * })
 *
 * // 使用客户端
 * const session = await client.session.create({
 *   project: { path: "/my-project" }
 * })
 * ```
 */
export function createOpencodeClient(config?: Config & { directory?: string }) {
  // 检查是否已提供自定义 fetch 函数
  if (!config?.fetch) {
    // 创建自定义 fetch 函数
    // 这个函数禁用了请求超时，这对于长时间运行的 AI 请求很重要
    const customFetch: any = (req: any) => {
      // 禁用 Bun 的默认超时行为
      // @ts-ignore - 忽略 TypeScript 对 timeout 属性的类型检查
      req.timeout = false

      // 调用标准 fetch API 发送请求
      return fetch(req)
    }

    // 将自定义 fetch 添加到配置中
    // 使用展开运算符保留原有配置
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  // 如果提供了 directory 选项，添加相应的请求头
  // 这告诉服务器在哪个目录下执行操作
  if (config?.directory) {
    // 检查目录路径是否包含非 ASCII 字符
    // /[^\x00-\x7F]/ 匹配任何不在 ASCII 范围内的字符
    const isNonASCII = /[^\x00-\x7F]/.test(config.directory)

    // 如果包含非 ASCII 字符，进行 URL 编码
    // 这确保中文、日文等多字节字符能正确传输
    const encodedDirectory = isNonASCII
      ? encodeURIComponent(config.directory)
      : config.directory

    // 合并请求头，保留用户提供的其他头
    config.headers = {
      ...config.headers,
      // 添加 x-opencode-directory 头
      // 如果包含非 ASCII 字符，使用编码后的路径
      "x-opencode-directory": encodedDirectory,
    }
  }

  // 创建底层客户端
  // 这是基于 OpenAPI 规范自动生成的客户端
  const client = createClient(config)

  // 包装为高级 OpencodeClient 并返回
  // OpencodeClient 提供了更友好的 API 接口
  return new OpencodeClient({ client })
}
