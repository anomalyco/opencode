/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src
 * ============================================================================
 *
 * 文件作用：
 * OpenCode CLI 主入口点。定义命令行界面、全局错误处理和所有可用命令。
 *
 * 主要功能：
 * - yargs CLI 解析器配置
 * - 全局错误和异常处理（unhandledRejection, uncaughtException）
 * - 日志初始化和配置
 * - 所有 CLI 命令注册
 * - 错误格式化和显示
 *
 * 依赖关系：
 * - yargs：命令行参数解析
 * - ./cli/cmd/*：各种 CLI 命令
 * - ./util/log：日志系统
 * - ./installation：版本信息
 * - ./cli/ui：用户界面
 * - @opencode-ai/util/error：命名错误
 * - os：EOL 常量
 *
 * 导出内容：
 * 无（这是主入口文件，不导出任何内容）
 *
 * 注册的命令：
 * - acp：ACP 服务器命令
 * - agent：Agent 管理
 * - attach：附加到运行中的服务器
 * - auth：认证管理
 * - debug：调试工具
 * - export：导出会话
 * - generate：代码生成
 * - github：GitHub 集成
 * - import：导入会话
 * - mcp：MCP 服务器管理
 * - models：模型管理
 * - pr：PR 检出
 * - run：运行 Agent
 * - serve：启动服务器
 * - session：会话管理
 * - stats：统计信息
 * - thread：TUI 线程命令
 * - uninstall：卸载
 * - upgrade：升级
 * - web：Web 界面
 *
 * 环境变量：
 * - AGENT：设置为 "1" 表示在 Agent 环境中运行
 * - OPENCODE：设置为 "1" 表示在 OpenCode 环境中运行
 *
 * @package opencode
 * @module main
 */

// 导入 yargs 命令行解析器
import yargs from "yargs"

// 导入 yargs 辅助函数，用于隐藏 Node.js 参数
import { hideBin } from "yargs/helpers"

// 导入运行命令
import { RunCommand } from "./cli/cmd/run"

// 导入生成命令
import { GenerateCommand } from "./cli/cmd/generate"

// 导入日志工具
import { Log } from "./util/log"

// 导入认证命令
import { AuthCommand } from "./cli/cmd/auth"

// 导入 Agent 命令
import { AgentCommand } from "./cli/cmd/agent"

// 导入升级命令
import { UpgradeCommand } from "./cli/cmd/upgrade"

// 导入卸载命令
import { UninstallCommand } from "./cli/cmd/uninstall"

// 导入模型命令
import { ModelsCommand } from "./cli/cmd/models"

// 导入 UI 工具
import { UI } from "./cli/ui"

// 导入安装模块
import { Installation } from "./installation"

// 导入命名错误
import { NamedError } from "@opencode-ai/util/error"

// 导入格式化错误
import { FormatError } from "./cli/error"

// 导入服务命令
import { ServeCommand } from "./cli/cmd/serve"

// 导入调试命令
import { DebugCommand } from "./cli/cmd/debug"

// 导入统计命令
import { StatsCommand } from "./cli/cmd/stats"

// 导入 MCP 命令
import { McpCommand } from "./cli/cmd/mcp"

// 导入 GitHub 命令
import { GithubCommand } from "./cli/cmd/github"

// 导入导出命令
import { ExportCommand } from "./cli/cmd/export"

// 导入导入命令
import { ImportCommand } from "./cli/cmd/import"

// 导入附加命令
import { AttachCommand } from "./cli/cmd/tui/attach"

// 导入 TUI 线程命令
import { TuiThreadCommand } from "./cli/cmd/tui/thread"

// 导入 ACP 命令
import { AcpCommand } from "./cli/cmd/acp"

// 导入 EOL 常量
import { EOL } from "os"

// 导入 Web 命令
import { WebCommand } from "./cli/cmd/web"

// 导入 PR 命令
import { PrCommand } from "./cli/cmd/pr"

// 导入会话命令
import { SessionCommand } from "./cli/cmd/session"

/**
 * 未处理的 Promise 拒绝处理器
 *
 * 捕获所有未处理的 Promise rejection，记录错误日志。
 */
process.on("unhandledRejection", (e) => {
  // 使用默认日志记录器记录 rejection 错误
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

/**
 * 未捕获的异常处理器
 *
 * 捕获所有未处理的异常，记录错误日志。
 */
process.on("uncaughtException", (e) => {
  // 使用默认日志记录器记录异常错误
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

/**
 * 创建 yargs CLI 解析器
 *
 * 配置命令行界面选项和中间件。
 */
const cli = yargs(hideBin(process.argv))
  // 配置解析器：将 -- 后的参数作为字符串值
  .parserConfiguration({ "populate--": true })
  // 设置脚本名称为 "opencode"
  .scriptName("opencode")
  // 设置帮助文本换行宽度为 100 字符
  .wrap(100)
  // 定义帮助选项
  .help("help", "show help")
  .alias("help", "h")  // 帮助的短选项
  // 定义版本选项
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")  // 版本的短选项
  // 日志打印选项：是否将日志输出到 stderr
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  // 日志级别选项
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  // 全局中间件：在命令执行前初始化日志和环境变量
  .middleware(async (opts) => {
    // 初始化日志系统
    await Log.init({
      // 如果命令行包含 --print-logs，则打印日志
      print: process.argv.includes("--print-logs"),
      // 如果是本地版本，启用开发者模式
      dev: Installation.isLocal(),
      // 确定日志级别
      level: (() => {
        // 优先使用命令行指定的日志级别
        if (opts.logLevel) return opts.logLevel as Log.Level
        // 本地版本默认使用 DEBUG 级别
        if (Installation.isLocal()) return "DEBUG"
        // 生产版本默认使用 INFO 级别
        return "INFO"
      })(),
    })

    // 设置环境变量表示在 Agent 环境中运行
    process.env.AGENT = "1"

    // 设置环境变量表示在 OpenCode 环境中运行
    process.env.OPENCODE = "1"

    // 记录启动信息
    Log.Default.info("opencode", {
      version: Installation.VERSION,
      args: process.argv.slice(2),  // 记录命令行参数（排除 Node 和脚本路径）
    })
  })
  // 设置使用说明（显示 Logo）
  .usage("\n" + UI.logo())
  // 定义 completion 命令（生成 shell 自动补全脚本）
  .completion("completion", "generate shell completion script")
  // 注册所有命令
  .command(AcpCommand)        // ACP 服务器命令
  .command(McpCommand)        // MCP 服务器管理
  .command(TuiThreadCommand)  // TUI 线程命令
  .command(AttachCommand)     // 附加到运行中的服务器
  .command(RunCommand)        // 运行 Agent
  .command(GenerateCommand)   // 代码生成
  .command(DebugCommand)      // 调试工具
  .command(AuthCommand)       // 认证管理
  .command(AgentCommand)      // Agent 管理
  .command(UpgradeCommand)    // 升级
  .command(UninstallCommand)  // 卸载
  .command(ServeCommand)      // 启动服务器
  .command(WebCommand)        // Web 界面
  .command(ModelsCommand)     // 模型管理
  .command(StatsCommand)      // 统计信息
  .command(ExportCommand)     // 导出会话
  .command(ImportCommand)     // 导入会话
  .command(GithubCommand)     // GitHub 集成
  .command(PrCommand)         // PR 检出
  .command(SessionCommand)    // 会话管理
  // 失败处理：处理命令行解析错误
  .fail((msg, err) => {
    // 如果是参数错误，显示帮助信息
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    // 其他错误直接抛出
    if (err) throw err
    // 无错误但解析失败，退出
    process.exit(1)
  })
  // 启用严格模式（不允许未知参数）
  .strict()

/**
 * 主执行流程
 *
 * 解析命令行参数并执行相应命令。
 * 处理所有类型的错误并格式化输出。
 */
try {
  // 解析命令行参数并执行命令
  await cli.parse()
} catch (e) {
  // 构建错误数据对象
  let data: Record<string, any> = {}

  // 如果是命名错误，提取其数据
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  // 如果是标准错误，提取其属性
  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  // 如果是模块解析错误，提取其属性
  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }

  // 记录致命错误到日志
  Log.Default.error("fatal", data)

  // 格式化错误并显示给用户
  const formatted = FormatError(e)

  // 如果错误格式化成功，显示格式化的错误
  if (formatted) UI.error(formatted)

  // 如果格式化失败，显示通用错误消息和日志文件位置
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    console.error(e instanceof Error ? e.message : String(e))
  }

  // 设置退出码为 1（表示错误）
  process.exitCode = 1
} finally {
  // 显式退出进程
  // 某些子进程不会正确响应 SIGTERM 等信号
  // 最显著的是某些基于 Docker 容器的 MCP 服务器，除非使用 `docker run --init` 运行
  // 显式退出以避免任何挂起的子进程
  process.exit()
}
