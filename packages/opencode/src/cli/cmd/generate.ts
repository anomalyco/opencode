/**
 * ============================================================================
 * 文件名：generate.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * OpenAPI 规范生成命令。生成服务器的 OpenAPI 规范并添加代码示例。
 *
 * 主要功能：
 * - GenerateCommand：生成 OpenAPI 规范命令
 * - 为每个操作添加 JavaScript 代码示例
 * - 输出 OpenAPI JSON 规范到 stdout
 *
 * 依赖关系：
 * - ../../server/server：服务器 OpenAPI 规范
 * - yargs：命令行参数解析
 *
 * 导出内容：
 * - GenerateCommand：生成命令定义
 *
 * 代码示例格式：
 * - 使用 @opencode-ai/sdk
 * - 展示如何调用每个操作
 *
 * 输出：
 * - OpenAPI 3.x JSON 格式
 * - 包含 x-codeSamples 扩展字段
 *
 * 使用场景：
 * - 生成客户端 SDK
 * - 文档生成
 * - API 测试
 *
 * @package opencode
 * @module cli/cmd/generate
 */

// 导入服务器
import { Server } from "../../server/server"

// 导入命令模块类型
import type { CommandModule } from "yargs"

/**
 * OpenAPI 规范生成命令
 *
 * 生成服务器的 OpenAPI 规范，为每个操作添加 JavaScript 代码示例。
 */
export const GenerateCommand = {
  command: "generate",
  handler: async () => {
    // 获取服务器的 OpenAPI 规范
    const specs = await Server.openapi()
    // 遍历所有路径
    for (const item of Object.values(specs.paths)) {
      // 遍历所有 HTTP 方法
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item[method]
        // 跳过没有操作 ID 的操作
        if (!operation?.operationId) continue
        // 添加代码示例
        // @ts-expect-error - x-codeSamples 是 OpenAPI 扩展字段，不在标准类型中
        operation["x-codeSamples"] = [
          {
            lang: "js",
            source: [
              `import { createOpencodeClient } from "@opencode-ai/sdk`,
              ``,
              `const client = createOpencodeClient()`,
              `await client.${operation.operationId}({`,
              `  ...`,
              `})`,
            ].join("\n"),
          },
        ]
      }
    }
    // 转换为 JSON 字符串（格式化）
    const json = JSON.stringify(specs, null, 2)

    // 等待 stdout 完成写入后再调用 process.exit()
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(json, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },
} satisfies CommandModule
