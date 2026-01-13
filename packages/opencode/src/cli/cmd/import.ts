/**
 * ============================================================================
 * 文件名：import.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 会话导入命令模块。提供从 JSON 文件或 URL 导入会话数据的功能。
 *
 * 主要功能：
 * - ImportCommand：导入会话数据命令
 * - 支持从本地 JSON 文件导入
 * - 支持从 opencode.ai 分享 URL 导入
 * - 导入会话信息、消息和部分
 *
 * 依赖关系：
 * - yargs：命令行参数解析
 * - ../../session：会话管理
 * - ./cmd：命令包装
 * - ../bootstrap：实例引导
 * - ../../storage/storage：存储层
 * - ../../project/instance：实例管理
 * - os：行尾符
 *
 * 导出内容：
 * - ImportCommand：导入命令定义
 *
 * 支持的导入源：
 * - 本地 JSON 文件：/path/to/export.json
 * - 分享 URL：https://opncd.ai/share/<slug>
 *
 * 导入数据格式：
 * - info：会话元数据
 * - messages：消息数组
 *   - info：消息信息
 *   - parts：消息部分数组
 *
 * 存储结构：
 * - session：<projectID>:<sessionID>
 * - message：<sessionID>:<messageID>
 * - part：<messageID>:<partID>
 *
 * @package opencode
 * @module cli/cmd/import
 */

// 导入 yargs 类型
import type { Argv } from "yargs"

// 导入会话管理
import { Session } from "../../session"

// 导入命令包装
import { cmd } from "./cmd"

// 导入实例引导
import { bootstrap } from "../bootstrap"

// 导入存储层
import { Storage } from "../../storage/storage"

// 导入实例管理
import { Instance } from "../../project/instance"

// 导入行尾符
import { EOL } from "os"

/**
 * 会话导入命令
 *
 * 从 JSON 文件或 opencode.ai 分享 URL 导入会话数据。
 */
export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file or opencode.ai share URL",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    // 引导实例并执行命令
    await bootstrap(process.cwd(), async () => {
      // 声明导出数据变量
      let exportData:
        | {
            info: Session.Info
            messages: Array<{
              info: any
              parts: any[]
            }>
          }
        | undefined

      // 检查是否为 URL
      const isUrl = args.file.startsWith("http://") || args.file.startsWith("https://")

      // 处理 URL 导入
      if (isUrl) {
        // 匹配分享 URL 格式：https://opncd.ai/share/<slug>
        const urlMatch = args.file.match(/https?:\/\/opncd\.ai\/share\/([a-zA-Z0-9_-]+)/)
        if (!urlMatch) {
          // 无效的 URL 格式
          process.stdout.write(`Invalid URL format. Expected: https://opncd.ai/share/<slug>`)
          process.stdout.write(EOL)
          return
        }

        // 提取 slug
        const slug = urlMatch[1]
        // 从 API 获取分享数据
        const response = await fetch(`https://opncd.ai/api/share/${slug}`)

        // 检查响应状态
        if (!response.ok) {
          process.stdout.write(`Failed to fetch share data: ${response.statusText}`)
          process.stdout.write(EOL)
          return
        }

        // 解析 JSON 响应
        const data = await response.json()

        // 验证数据格式
        if (!data.info || !data.messages || Object.keys(data.messages).length === 0) {
          process.stdout.write(`Share not found: ${slug}`)
          process.stdout.write(EOL)
          return
        }

        // 转换数据格式
        exportData = {
          info: data.info,
          // 将消息对象转换为数组
          messages: Object.values(data.messages).map((msg: any) => {
            // 分离 parts 和 info
            const { parts, ...info } = msg
            return {
              info,
              parts,
            }
          }),
        }
      }
      // 处理本地文件导入
      else {
        // 读取本地文件
        const file = Bun.file(args.file)
        exportData = await file.json().catch(() => {})
        // 检查文件是否存在
        if (!exportData) {
          process.stdout.write(`File not found: ${args.file}`)
          process.stdout.write(EOL)
          return
        }
      }

      // 验证导出数据
      if (!exportData) {
        process.stdout.write(`Failed to read session data`)
        process.stdout.write(EOL)
        return
      }

      // 写入会话信息到存储
      await Storage.write(["session", Instance.project.id, exportData.info.id], exportData.info)

      // 遍历并写入每条消息
      for (const msg of exportData.messages) {
        // 写入消息信息
        await Storage.write(["message", exportData.info.id, msg.info.id], msg.info)

        // 遍历并写入每个消息部分
        for (const part of msg.parts) {
          await Storage.write(["part", msg.info.id, part.id], part)
        }
      }

      // 显示成功消息
      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
