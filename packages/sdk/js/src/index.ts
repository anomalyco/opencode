/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/sdk/js/src
 * ============================================================================
 *
 * 文件作用：
 * OpenCode SDK V1 版本的入口文件。
 * 提供创建 OpenCode 客户端和服务器的高级 API，
 * 同时提供便捷函数一键创建完整的客户端-服务器对。
 *
 * 主要功能：
 * - 重新导出客户端和服务器模块
 * - 提供一键创建客户端和服务器对的函数
 *
 * 依赖关系：
 * - client.ts：OpenCode 客户端实现
 * - server.ts：OpenCode 服务器实现
 *
 * 导出内容：
 * - createOpencodeClient：创建 OpenCode 客户端
 * - createOpencodeServer：创建 OpenCode 服务器
 * - createOpencode：一键创建客户端和服务器对
 *
 * 使用场景：
 * - 快速搭建 OpenCode 开发环境
 * - 测试和演示
 * - 本地开发
 *
 * @package sdk/js
 * @module index
 */

// 从客户端模块重新导出所有内容
// 这使得用户可以从这个入口文件导入客户端相关的内容
export * from "./client.js"

// 从服务器模块重新导出所有内容
// 这使得用户可以从这个入口文件导入服务器相关的内容
export * from "./server.js"

// 导入客户端创建函数，用于在 createOpencode 中使用
import { createOpencodeClient } from "./client.js"

// 导入服务器创建函数，用于在 createOpencode 中使用
import { createOpencodeServer } from "./server.js"

// 导入服务器选项类型，用于函数参数类型定义
import type { ServerOptions } from "./server.js"

/**
 * 创建 OpenCode 客户端和服务器对
 *
 * 这是一个便捷函数，用于同时创建 OpenCode 服务器和连接到它的客户端。
 * 适合用于本地开发、测试等场景。
 *
 * @param options - 服务器配置选项
 * @returns 包含客户端和服务器对象的对象
 *          - client: OpenCode 客户端实例
 *          - server: OpenCode 服务器实例（包含 url 和 close 方法）
 *
 * 执行流程：
 * 1. 使用提供的选项创建 OpenCode 服务器
 * 2. 等待服务器启动并获取其 URL
 * 3. 使用服务器 URL 创建客户端
 * 4. 返回客户端和服务器的组合对象
 *
 * 使用场景：
 * - 快速启动本地开发环境
 * - 集成测试
 * - 示例和演示代码
 *
 * @example
 * ```typescript
 * import { createOpencode } from "@opencode-ai/sdk"
 *
 * // 创建客户端和服务器对
 * const { client, server } = await createOpencode({
 *   hostname: "localhost",
 *   port: 4096,
 * })
 *
 * // 使用客户端进行 API 调用
 * const session = await client.session.create({ ... })
 *
 * // 完成后关闭服务器
 * server.close()
 * ```
 */
export async function createOpencode(options?: ServerOptions) {
  // 创建 OpenCode 服务器
  // 传入用户提供的选项（如果有）
  // 服务器会启动并监听指定端口
  const server = await createOpencodeServer({
    ...options,
  })

  // 创建连接到服务器的客户端
  // 使用服务器返回的 URL 作为 baseUrl
  // 这样客户端会自动连接到刚创建的服务器
  const client = createOpencodeClient({
    baseUrl: server.url,
  })

  // 返回包含客户端和服务器的对象
  // 用户可以使用客户端进行 API 调用
  // 也可以使用 server.close() 关闭服务器
  return {
    client,
    server,
  }
}
