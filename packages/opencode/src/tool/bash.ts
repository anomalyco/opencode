/**
 * ============================================================================
 * 文件名：bash.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Bash 工具模块。允许 AI 执行 shell 命令。
 *
 * 主要功能：
 * - BashTool：执行 shell 命令的工具
 * - 使用 tree-sitter 解析命令以确定权限需求
 * - 检测文件操作命令（cd、rm、cp、mv 等）
 * - 支持命令超时和取消
 * - 实时更新输出元数据
 *
 * 依赖关系：
 * - zod：类型验证
 * - child_process：进程生成
 * - ./tool：工具基类
 * - path：路径处理
 * - ./bash.txt：工具描述模板
 * - ../util/log：日志记录
 * - ../project/instance：实例管理
 * - @/util/lazy：惰性初始化
 * - web-tree-sitter：语法解析
 * - bun：Bun shell
 * - @/util/filesystem：文件系统工具
 * - @/shell/shell：shell 管理
 * - @/permission/arity：命令 arity 处理
 * - ./truncation：输出截断
 *
 * 导出内容：
 * - BashTool：Bash 工具定义
 * - log：日志记录器
 *
 * 参数：
 * - command：要执行的命令
 * - timeout：超时时间（毫秒，可选）
 * - workdir：工作目录（可选，默认实例目录）
 * - description：命令描述（5-10 词）
 *
 * 返回：
 * - title：命令描述
 * - output：命令输出
 * - metadata：元数据（输出、退出码、描述）
 *
 * 权限检测：
 * - 使用 tree-sitter 解析命令
 * - 检测文件操作命令
 * - 解析文件路径参数
 * - 请求 external_directory 和 bash 权限
 *
 * 进程管理：
 * - 使用 spawn 执行命令
 * - 支持超时自动终止
 * - 支持 abort 信号取消
 * - 使用 detached 模式（非 Windows）
 *
 * @package opencode
 * @module tool/bash
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入子进程生成
import { spawn } from "child_process"

// 导入工具基类
import { Tool } from "./tool"

// 导入路径处理
import path from "path"

// 导入工具描述模板
import DESCRIPTION from "./bash.txt"

// 导入日志模块
import { Log } from "../util/log"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入惰性初始化
import { lazy } from "@/util/lazy"

// 导入 tree-sitter 语言支持
import { Language } from "web-tree-sitter"

// 导入 Bun shell
import { $ } from "bun"

// 导入文件系统工具
import { Filesystem } from "@/util/filesystem"

// 导入 URL 转换
import { fileURLToPath } from "url"

// 导入功能标志
import { Flag } from "@/flag/flag.ts"

// 导入 shell 管理
import { Shell } from "@/shell/shell"

// 导入 bash arity 处理
import { BashArity } from "@/permission/arity"

// 导入截断模块
import { Truncate } from "./truncation"

// 元数据最大长度
const MAX_METADATA_LENGTH = 30_000

// 默认超时时间（2 分钟或配置值）
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

// 创建日志记录器
export const log = Log.create({ service: "bash-tool" })

/**
 * 解析 WASM 资源路径
 *
 * 将 file:// URL 或相对路径转换为绝对路径。
 *
 * @param asset - 资源路径或 URL
 * @returns 绝对路径
 */
const resolveWasm = (asset: string) => {
  // file:// URL 转路径
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  // 已是绝对路径
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  // 相对路径，解析为绝对路径
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

/**
 * 惰性初始化 tree-sitter Bash 解析器
 *
 * 使用 web-tree-sitter 解析 Bash 命令，
 * 用于提取命令和参数以进行权限检查。
 */
const parser = lazy(async () => {
  // 导入 tree-sitter 解析器
  const { Parser } = await import("web-tree-sitter")

  // 导入 tree-sitter WASM
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)

  // 初始化解析器
  await Parser.init({
    locateFile() {
      return treePath
    },
  })

  // 导入 Bash 语言 WASM
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)

  // 加载 Bash 语言
  const bashLanguage = await Language.load(bashPath)

  // 创建并配置解析器
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: 可能需要重命名此工具以更好地支持其他 shell

/**
 * Bash 工具定义
 *
 * 允许 AI 执行 shell 命令。
 */
export const BashTool = Tool.define("bash", async () => {
  // 获取可接受的 shell
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    // 生成工具描述（替换变量）
    description: DESCRIPTION
      .replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),

    // 参数 Schema
    parameters: z.object({
      // 要执行的命令
      command: z.string().describe("The command to execute"),
      // 可选超时时间（毫秒）
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      // 工作目录
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      // 命令描述（5-10 词）
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),

    async execute(params, ctx) {
      // 确定工作目录
      const cwd = params.workdir || Instance.directory

      // 验证超时值
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }

      // 确定超时时间
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      // 解析命令
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }

      // 跟踪需要权限的目录
      const directories = new Set<string>()
      // 如果工作目录不在实例内，需要权限
      if (!Instance.containsPath(cwd)) directories.add(cwd)

      // 跟踪命令模式和总是允许的模式
      const patterns = new Set<string>()
      const always = new Set<string>()

      // 遍历所有命令节点
      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue

        // 提取命令部分
        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue

          // 过滤掉不需要的节点类型
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // 检查文件操作命令
        // 不是详尽列表，但涵盖大多数常见情况
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            // 跳过选项和 chmod 的权限模式
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue

            // 解析路径
            const resolved = await $`realpath ${arg}`
              .cwd(cwd)
              .quiet()
              .nothrow()
              .text()
              .then((x) => x.trim())

            log.info("resolved path", { arg, resolved })

            if (resolved) {
              // Git Bash on Windows 返回 Unix 风格路径
              const normalized =
                process.platform === "win32" && resolved.match(/^\/[a-z]\//)
                  ? resolved.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
                  : resolved

              // 如果路径不在实例内，需要权限
              if (!Instance.containsPath(normalized)) directories.add(normalized)
            }
          }
        }

        // cd 已被上面的检查覆盖
        if (command.length && command[0] !== "cd") {
          // 添加命令模式
          patterns.add(command.join(" "))
          // 添加命令前缀模式（支持参数变化）
          always.add(BashArity.prefix(command).join(" ") + "*")
        }
      }

      // 请求外部目录权限
      if (directories.size > 0) {
        await ctx.ask({
          permission: "external_directory",
          patterns: Array.from(directories),
          always: Array.from(directories).map((x) => path.dirname(x) + "*"),
          metadata: {},
        })
      }

      // 请求 bash 权限
      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      // 生成进程
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        // detached 模式（非 Windows）允许进程组管理
        detached: process.platform !== "win32",
      })

      let output = ""

      // 初始化元数据
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      // 附加输出并更新元数据的函数
      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            // 截断元数据以避免大量数据
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
          },
        })
      }

      // 监听 stdout 和 stderr
      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      // 跟踪进程状态
      let timedOut = false
      let aborted = false
      let exited = false

      // 终止函数（杀死进程树）
      const kill = () => Shell.killTree(proc, { exited: () => exited })

      // 如果已经中止，立即终止进程
      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      // 监听 abort 信号
      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      // 超时定时器
      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      // 等待进程完成
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      // 构建结果元数据
      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      // 如果有元数据，添加到输出
      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          // 截断输出
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
