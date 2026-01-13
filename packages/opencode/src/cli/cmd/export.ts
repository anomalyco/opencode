/**
 * ============================================================================
 * 文件名：export.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 会话导出命令模块。提供将会话数据导出为 JSON 格式的功能。
 *
 * 主要功能：
 * - ExportCommand：导出会话数据命令
 * - 支持通过会话 ID 或交互式选择导出
 * - 导出包含会话信息和消息列表
 *
 * 依赖关系：
 * - yargs：命令行参数解析
 * - ../../session：会话管理
 * - ./cmd：命令包装
 * - ../bootstrap：实例引导
 * - ../ui：UI 工具
 * - @clack/prompts：交互式提示
 * - os：行尾符
 *
 * 导出内容：
 * - ExportCommand：导出命令定义
 *
 * 导出格式：
 * - JSON 格式
 * - 包含 info：会话元数据
 * - 包含 messages：消息列表（每个消息包含 info 和 parts）
 *
 * 使用方式：
 * - 交互式：opencode export（从列表中选择会话）
 * - 直接指定：opencode export <sessionID>
 * - 输出到 stdout，可重定向到文件
 *
 * @package opencode
 * @module cli/cmd/export
 */

// 导入 yargs 类型
import type { Argv } from "yargs"

// 导入会话管理
import { Session } from "../../session"

// 导入命令包装
import { cmd } from "./cmd"

// 导入实例引导
import { bootstrap } from "../bootstrap"

// 导入 UI 工具
import { UI } from "../ui"

// 导入交互式提示库
import * as prompts from "@clack/prompts"

// 导入行尾符
import { EOL } from "os"

/**
 * 会话导出命令
 *
 * 将会话数据导出为 JSON 格式到 stdout。
 */
export const ExportCommand = cmd({
  command: "export [sessionID]",
  describe: "export session data as JSON",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session id to export",
      type: "string",
    })
  },
  handler: async (args) => {
    // 引导实例并执行命令
    await bootstrap(process.cwd(), async () => {
      // 获取会话 ID 参数
      let sessionID = args.sessionID
      process.stderr.write(`Exporting session: ${sessionID ?? "latest"}`)

      // 如果没有提供会话 ID，进入交互式选择模式
      if (!sessionID) {
        UI.empty()
        prompts.intro("Export session", {
          output: process.stderr,
        })

        // 获取所有会话列表
        const sessions = []
        for await (const session of Session.list()) {
          sessions.push(session)
        }

        // 如果没有会话，显示错误并返回
        if (sessions.length === 0) {
          prompts.log.error("No sessions found", {
            output: process.stderr,
          })
          prompts.outro("Done", {
            output: process.stderr,
          })
          return
        }

        // 按更新时间排序（最新的在前）
        sessions.sort((a, b) => b.time.updated - a.time.updated)

        // 让用户选择要导出的会话
        const selectedSession = await prompts.autocomplete({
          message: "Select session to export",
          maxItems: 10,
          options: sessions.map((session) => ({
            label: session.title,
            value: session.id,
            hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
          })),
          output: process.stderr,
        })

        if (prompts.isCancel(selectedSession)) {
          throw new UI.CancelledError()
        }

        // 使用选中的会话 ID
        sessionID = selectedSession as string

        prompts.outro("Exporting session...", {
          output: process.stderr,
        })
      }

      try {
        // 获取会话信息
        const sessionInfo = await Session.get(sessionID!)
        // 获取会话消息列表
        const messages = await Session.messages({ sessionID: sessionID! })

        // 构建导出数据
        const exportData = {
          info: sessionInfo,
          messages: messages.map((msg) => ({
            info: msg.info,
            parts: msg.parts,
          })),
        }

        // 输出 JSON 到 stdout
        process.stdout.write(JSON.stringify(exportData, null, 2))
        process.stdout.write(EOL)
      } catch (error) {
        // 会话未找到错误
        UI.error(`Session not found: ${sessionID!}`)
        process.exit(1)
      }
    })
  },
})
