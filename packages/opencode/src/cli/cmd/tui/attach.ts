/**
 * ============================================================================
 * 文件名：attach.ts
 * 所属包：packages/opencode/src/cli/cmd/tui
 * ============================================================================
 *
 * 文件作用：
 * Attach 命令模块。附加到运行中的 OpenCode 服务器并启动 TUI。
 *
 * 主要功能：
 * - AttachCommand：附加命令
 * - 连接到远程 OpenCode 服务器
 * - 启动 TUI 界面
 * - 支持继续指定会话
 * - 支持指定工作目录
 *
 * 依赖关系：
 * - ../cmd：命令包装
 * - ./app：TUI 应用入口
 *
 * 导出内容：
 * - AttachCommand：附加命令定义
 *
 * 命令参数：
 * - url：服务器 URL（必需），例如 http://localhost:4096
 * - --dir：运行目录（可选）
 * - --session (-s)：要继续的会话 ID（可选）
 *
 * @package opencode
 * @module cli/cmd/tui/attach
 */

// 导入命令包装
import { cmd } from "../cmd"

// 导入 TUI 应用入口
import { tui } from "./app"

/**
 * 附加命令
 *
 * 附加到运行中的 OpenCode 服务器并启动 TUI。
 */
export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      // 服务器 URL 位置参数
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      // 工作目录选项
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      // 会话 ID 选项
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      }),
  handler: async (args) => {
    // 如果指定了目录，切换到该目录
    if (args.dir) process.chdir(args.dir)
    // 启动 TUI
    await tui({
      url: args.url,
      args: { sessionID: args.session },
      directory: args.dir ? process.cwd() : undefined,
    })
  },
})
