/**
 * ============================================================================
 * 文件名：run.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 运行命令模块。提供执行 OpenCode 消息的主要 CLI 入口。
 *
 * 主要功能：
 * - RunCommand：运行消息命令
 * - 支持本地和远程（attach）两种模式
 * - 支持文件附件、会话继续、模型选择等
 * - 实时显示事件输出
 * - 处理权限请求
 *
 * 依赖关系：
 * - yargs：命令行参数解析
 * - path：路径处理
 * - ../ui：UI 工具
 * - ./cmd：命令包装
 * - ../../flag/flag：标志位
 * - ../bootstrap：实例引导
 * - ../../command：命令系统
 * - @opencode-ai/sdk/v2：OpenCode SDK
 * - ../../server/server：服务器
 * - ../../provider/provider：提供商管理
 * - ../../agent/agent：Agent 管理
 * - @clack/prompts：交互式提示
 * - os：行尾符
 *
 * 导出内容：
 * - RunCommand：运行命令定义
 *
 * 命令参数：
 * - message：要发送的消息
 * - --command：要执行的命令（使用 message 作为参数）
 * - --continue (-c)：继续上一个会话
 * - --session (-s)：继续指定会话
 * - --share：分享会话
 * - --model (-m)：使用的模型（provider/model 格式）
 * - --agent：使用的 Agent
 * - --format：输出格式（default 或 json）
 * - --file (-f)：附加的文件
 * - --title：会话标题
 * - --attach：附加到运行中的服务器
 * - --port：本地服务器端口
 * --variant：模型变体（推理强度）
 *
 * 输出模式：
 * - default：格式化输出（Markdown 渲染、颜色）
 * - json：原始 JSON 事件流
 *
 * @package opencode
 * @module cli/cmd/run
 */

// 导入 yargs 类型
import type { Argv } from "yargs"

// 导入路径处理
import path from "path"

// 导入 UI 工具
import { UI } from "../ui"

// 导入命令包装
import { cmd } from "./cmd"

// 导入标志位
import { Flag } from "../../flag/flag"

// 导入实例引导
import { bootstrap } from "../bootstrap"

// 导入命令系统
import { Command } from "../../command"

// 导入行尾符
import { EOL } from "os"

// 导入交互式提示
import { select } from "@clack/prompts"

// 导入 OpenCode SDK
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"

// 导入服务器
import { Server } from "../../server/server"

// 导入提供商管理
import { Provider } from "../../provider/provider"

// 导入 Agent 管理
import { Agent } from "../../agent/agent"

/**
 * 工具显示配置
 *
 * 将工具名称映射到显示名称和颜色样式。
 */
const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

/**
 * 运行命令
 *
 * 执行 OpenCode 消息的主要入口。
 */
export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run opencode with a message",
  builder: (yargs: Argv) => {
    return yargs
      // 位置参数：消息
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      // 命令选项
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      // 继续上一个会话
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      // 继续指定会话
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      // 分享会话
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      // 模型选择
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      // Agent 选择
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      // 输出格式
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      // 文件附件
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      // 会话标题
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      // 附加到服务器
      .option("attach", {
        type: "string",
        describe: "attach to a running opencode server (e.g., http://localhost:4096)",
      })
      // 本地服务器端口
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      // 模型变体
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
  },
  handler: async (args) => {
    // 合并位置参数和 -- 后的参数
    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    // 处理文件附件
    const fileParts: any[] = []
    if (args.file) {
      const files = Array.isArray(args.file) ? args.file : [args.file]

      for (const filePath of files) {
        // 解析为绝对路径
        const resolvedPath = path.resolve(process.cwd(), filePath)
        const file = Bun.file(resolvedPath)
        // 获取文件状态
        const stats = await file.stat().catch(() => {})
        if (!stats) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }
        // 检查文件是否存在
        if (!(await file.exists())) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }

        // 确定 MIME 类型
        const stat = await file.stat()
        const mime = stat.isDirectory() ? "application/x-directory" : "text/plain"

        // 添加文件部分
        fileParts.push({
          type: "file",
          url: `file://${resolvedPath}`,
          filename: path.basename(resolvedPath),
          mime,
        })
      }
    }

    // 从 stdin 读取输入（非 TTY 环境）
    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    // 验证必须有消息或命令
    if (message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(1)
    }

    /**
     * 执行会话
     *
     * @param sdk - OpenCode SDK 客户端
     * @param sessionID - 会话 ID
     */
    const execute = async (sdk: OpencodeClient, sessionID: string) => {
      /**
       * 打印事件到控制台
       *
       * @param color - 颜色样式
       * @param type - 类型名称
       * @param title - 标题
       */
      const printEvent = (color: string, type: string, title: string) => {
        UI.println(
          color + `|`,
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + title,
        )
      }

      /**
       * 输出 JSON 事件
       *
       * @param type - 事件类型
       * @param data - 事件数据
       * @returns 是否已输出（true 表示跳过默认处理）
       */
      const outputJsonEvent = (type: string, data: any) => {
        if (args.format === "json") {
          process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
          return true
        }
        return false
      }

      // 订阅事件流
      const events = await sdk.event.subscribe()
      let errorMsg: string | undefined

      // 事件处理循环
      const eventProcessor = (async () => {
        for await (const event of events.stream) {
          // 处理消息部分更新事件
          if (event.type === "message.part.updated") {
            const part = event.properties.part
            // 跳过不属于当前会话的事件
            if (part.sessionID !== sessionID) continue

            // 工具调用完成
            if (part.type === "tool" && part.state.status === "completed") {
              if (outputJsonEvent("tool_use", { part })) continue
              const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
              const title =
                part.state.title ||
                (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
              printEvent(color, tool, title)
              // 如果是 bash 命令且有输出，显示输出
              if (part.tool === "bash" && part.state.output?.trim()) {
                UI.println()
                UI.println(part.state.output)
              }
            }

            // 步骤开始
            if (part.type === "step-start") {
              if (outputJsonEvent("step_start", { part })) continue
            }

            // 步骤结束
            if (part.type === "step-finish") {
              if (outputJsonEvent("step_finish", { part })) continue
            }

            // 文本部分完成
            if (part.type === "text" && part.time?.end) {
              if (outputJsonEvent("text", { part })) continue
              const isPiped = !process.stdout.isTTY
              if (!isPiped) UI.println()
              // 渲染 Markdown（非管道模式）或直接输出
              process.stdout.write((isPiped ? part.text : UI.markdown(part.text)) + EOL)
              if (!isPiped) UI.println()
            }
          }

          // 处理会话错误事件
          if (event.type === "session.error") {
            const props = event.properties
            if (props.sessionID !== sessionID || !props.error) continue
            let err = String(props.error.name)
            if ("data" in props.error && props.error.data && "message" in props.error.data) {
              err = String(props.error.data.message)
            }
            errorMsg = errorMsg ? errorMsg + EOL + err : err
            if (outputJsonEvent("error", { error: props.error })) continue
            UI.error(err)
          }

          // 处理会话空闲事件（会话结束）
          if (event.type === "session.idle" && event.properties.sessionID === sessionID) {
            break
          }

          // 处理权限请求事件
          if (event.type === "permission.asked") {
            const permission = event.properties
            if (permission.sessionID !== sessionID) continue
            // 询问用户授权
            const result = await select({
              message: `Permission required: ${permission.permission} (${permission.patterns.join(", ")})`,
              options: [
                { value: "once", label: "Allow once" },
                { value: "always", label: "Always allow: " + permission.always.join(", ") },
                { value: "reject", label: "Reject" },
              ],
              initialValue: "once",
            }).catch(() => "reject")
            // 处理取消操作
            const response = (result.toString().includes("cancel") ? "reject" : result) as "once" | "always" | "reject"
            // 响应权限请求
            await sdk.permission.respond({
              sessionID,
              permissionID: permission.id,
              response,
            })
          }
        }
      })()

      // 验证 Agent 是否有效
      const resolvedAgent = await (async () => {
        if (!args.agent) return undefined
        const agent = await Agent.get(args.agent)
        if (!agent) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" not found. Falling back to default agent`,
          )
          return undefined
        }
        // 检查是否为子 Agent
        if (agent.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return args.agent
      })()

      // 执行命令或消息
      if (args.command) {
        await sdk.session.command({
          sessionID,
          agent: resolvedAgent,
          model: args.model,
          command: args.command,
          arguments: message,
          variant: args.variant,
        })
      } else {
        // 解析模型参数
        const modelParam = args.model ? Provider.parseModel(args.model) : undefined
        await sdk.session.prompt({
          sessionID,
          agent: resolvedAgent,
          model: modelParam,
          variant: args.variant,
          parts: [...fileParts, { type: "text", text: message }],
        })
      }

      await eventProcessor
      // 如果有错误，退出并返回错误代码
      if (errorMsg) process.exit(1)
    }

    // 附加到远程服务器模式
    if (args.attach) {
      const sdk = createOpencodeClient({ baseUrl: args.attach })

      // 获取或创建会话 ID
      const sessionID = await (async () => {
        // 继续上一个会话
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        // 继续指定会话
        if (args.session) return args.session

        // 确定会话标题
        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        // 创建新会话
        const result = await sdk.session.create(
          title
            ? {
                title,
                // 默认拒绝问题权限
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              }
            : {
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              },
        )
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      // 处理会话分享
      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.OPENCODE_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }).catch((error) => {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          }
          return { error }
        })
        if (!shareResult.error && "data" in shareResult && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      return await execute(sdk, sessionID)
    }

    // 本地模式
    await bootstrap(process.cwd(), async () => {
      // 创建本地 fetch 函数（使用内部服务器）
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.App().fetch(request)
      }) as typeof globalThis.fetch
      // 创建 SDK 客户端
      const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })

      // 验证命令是否存在
      if (args.command) {
        const exists = await Command.get(args.command)
        if (!exists) {
          UI.error(`Command "${args.command}" not found`)
          process.exit(1)
        }
      }

      // 获取或创建会话 ID
      const sessionID = await (async () => {
        // 继续上一个会话
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        // 继续指定会话
        if (args.session) return args.session

        // 确定会话标题
        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        // 创建新会话
        const result = await sdk.session.create(title ? { title } : {})
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      // 处理会话分享
      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.OPENCODE_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }).catch((error) => {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          }
          return { error }
        })
        if (!shareResult.error && "data" in shareResult && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      await execute(sdk, sessionID)
    })
  },
})
