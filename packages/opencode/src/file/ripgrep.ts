/**
 * ============================================================================
 * 文件名：ripgrep.ts
 * 所属包：packages/opencode/src/file
 * ============================================================================
 *
 * 文件作用：
 * Ripgrep 工具函数模块。提供对 ripgrep（rg）命令的封装，
 * 包括自动下载、文件列表生成、目录树渲染和内容搜索。
 *
 * 主要功能：
 * - Stats/Begin/Match/End/Summary：ripgrep JSON 输出类型
 * - state：ripgrep 二进制文件管理（自动下载）
 * - filepath()：获取 ripgrep 可执行文件路径
 * - files(input)：生成器，列出项目中的所有文件
 * - tree(input)：生成目录树的文本表示
 * - search(input)：使用 ripgrep 搜索文件内容
 * - ExtractionFailedError：解压失败错误
 * - UnsupportedPlatformError：不支持的平台错误
 * - DownloadFailedError：下载失败错误
 *
 * 依赖关系：
 * - path：路径处理
 * - ../global：全局配置路径
 * - fs/promises：文件系统 promise API
 * - zod：类型验证
 * - @opencode-ai/util/error：命名错误
 * - ../util/lazy：懒加载
 * - bun：Bun 运行时（$）
 * - @zip.js/zip.js：ZIP 文件处理
 * - ../util/log：日志记录
 *
 * 导出内容：
 * - Ripgrep namespace：ripgrep 工具命名空间
 *   - Stats/Begin/Match/End/Summary：类型定义
 *   - Result/Match/Begin/End/Summary：类型导出
 *   - ExtractionFailedError：解压失败错误
 *   - UnsupportedPlatformError：不支持平台错误
 *   - DownloadFailedError：下载失败错误
 *   - filepath()：获取可执行文件路径
 *   - files()：列出文件
 *   - tree()：生成目录树
 *   - search()：搜索内容
 *
 * 平台支持：
 * - arm64-darwin (aarch64-apple-darwin)
 * - arm64-linux (aarch64-unknown-linux-gnu)
 * - x64-darwin (x86_64-apple-darwin)
 * - x64-linux (x86_64-unknown-linux-musl)
 * - x64-win32 (x86_64-pc-windows-msvc)
 *
 * @package opencode
 * @module file/ripgrep
 */

// 导入路径模块
import path from "path"

// 导入全局配置路径
import { Global } from "../global"

// 导入文件系统 promise API
import fs from "fs/promises"

// 导入 Zod
import z from "zod"

// 导入命名错误工具
import { NamedError } from "@opencode-ai/util/error"

// 导入懒加载工具
import { lazy } from "../util/lazy"

// 导入 Bun shell
import { $ } from "bun"

// 导入 ZIP 处理库
import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"

// 导入日志工具
import { Log } from "@/util/log"

/**
 * Ripgrep 工具命名空间
 *
 * 封装 ripgrep 命令行工具的功能。
 */
export namespace Ripgrep {
  // 创建日志记录器
  const log = Log.create({ service: "ripgrep" })

  /**
   * 搜索统计信息
   *
   * ripgrep JSON 输出中的统计数据。
   */
  const Stats = z.object({
    // 耗时信息
    elapsed: z.object({
      secs: z.number(),
      nanos: z.number(),
      human: z.string(),
    }),
    // 搜索次数
    searches: z.number(),
    // 有匹配的搜索次数
    searches_with_match: z.number(),
    // 搜索字节数
    bytes_searched: z.number(),
    // 输出字节数
    bytes_printed: z.number(),
    // 匹配行数
    matched_lines: z.number(),
    // 匹配数
    matches: z.number(),
  })

  /**
   * 文件开始事件
   *
   * 表示开始搜索一个新文件。
   */
  const Begin = z.object({
    type: z.literal("begin"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
    }),
  })

  /**
   * 匹配事件
   *
   * 表示找到匹配内容。
   */
  export const Match = z.object({
    type: z.literal("match"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      // 匹配的行内容
      lines: z.object({
        text: z.string(),
      }),
      // 行号
      line_number: z.number(),
      // 绝对偏移
      absolute_offset: z.number(),
      // 子匹配项
      submatches: z.array(
        z.object({
          match: z.object({
            text: z.string(),
          }),
          start: z.number(),
          end: z.number(),
        }),
      ),
    }),
  })

  /**
   * 文件结束事件
   *
   * 表示完成一个文件的搜索。
   */
  const End = z.object({
    type: z.literal("end"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      // 二进制偏移
      binary_offset: z.number().nullable(),
      stats: Stats,
    }),
  })

  /**
   * 汇总事件
   *
   * 表示整个搜索的汇总信息。
   */
  const Summary = z.object({
    type: z.literal("summary"),
    data: z.object({
      // 总耗时
      elapsed_total: z.object({
        human: z.string(),
        nanos: z.number(),
        secs: z.number(),
      }),
      stats: Stats,
    }),
  })

  /**
   * ripgrep 结果联合类型
   *
   * 使用 discriminatedUnion 根据类型字段区分不同事件。
   */
  const Result = z.union([Begin, Match, End, Summary])

  // 导出类型
  export type Result = z.infer<typeof Result>
  export type Match = z.infer<typeof Match>
  export type Begin = z.infer<typeof Begin>
  export type End = z.infer<typeof End>
  export type Summary = z.infer<typeof Summary>

  /**
   * 平台配置映射
   *
   * 定义每个平台对应的 ripgrep 发布包配置。
   */
  const PLATFORM = {
    "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
    "arm64-linux": {
      platform: "aarch64-unknown-linux-gnu",
      extension: "tar.gz",
    },
    "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
    "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
    "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
  } as const

  /**
   * 解压失败错误
   *
   * 当 ripgrep 归档解压失败时抛出。
   */
  export const ExtractionFailedError = NamedError.create(
    "RipgrepExtractionFailedError",
    z.object({
      filepath: z.string(),
      stderr: z.string(),
    }),
  )

  /**
   * 不支持的平台错误
   *
   * 当平台不在支持列表中时抛出。
   */
  export const UnsupportedPlatformError = NamedError.create(
    "RipgrepUnsupportedPlatformError",
    z.object({
      platform: z.string(),
    }),
  )

  /**
   * 下载失败错误
   *
   * 当 ripgrep 下载失败时抛出。
   */
  export const DownloadFailedError = NamedError.create(
    "RipgrepDownloadFailedError",
    z.object({
      url: z.string(),
      status: z.number(),
    }),
  )

  /**
   * ripgrep 状态（懒加载）
   *
   * 首次访问时自动下载并安装 ripgrep。
   */
  const state = lazy(async () => {
    // 首先检查系统中是否已安装 ripgrep
    let filepath = Bun.which("rg")
    if (filepath) return { filepath }

    // 设置本地安装路径
    filepath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))

    const file = Bun.file(filepath)

    // 如果本地不存在，下载并安装
    if (!(await file.exists())) {
      // 获取平台配置
      const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
      const config = PLATFORM[platformKey]
      if (!config) throw new UnsupportedPlatformError({ platform: platformKey })

      // ripgrep 版本
      const version = "14.1.1"
      const filename = `ripgrep-${version}-${config.platform}.${config.extension}`
      const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${filename}`

      // 下载归档文件
      const response = await fetch(url)
      if (!response.ok) throw new DownloadFailedError({ url, status: response.status })

      // 保存归档到本地
      const buffer = await response.arrayBuffer()
      const archivePath = path.join(Global.Path.bin, filename)
      await Bun.write(archivePath, buffer)

      // 解压 tar.gz 文件（macOS/Linux）
      if (config.extension === "tar.gz") {
        const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

        // 平台特定的解压参数
        if (platformKey.endsWith("-darwin")) args.push("--include=*/rg")
        if (platformKey.endsWith("-linux")) args.push("--wildcards", "*/rg")

        // 执行解压命令
        const proc = Bun.spawn(args, {
          cwd: Global.Path.bin,
          stderr: "pipe",
          stdout: "pipe",
        })
        await proc.exited

        // 检查解压是否成功
        if (proc.exitCode !== 0)
          throw new ExtractionFailedError({
            filepath,
            stderr: await Bun.readableStreamToText(proc.stderr),
          })
      }

      // 解压 zip 文件（Windows）
      if (config.extension === "zip") {
        if (config.extension === "zip") {
          // 创建 ZIP 阅读器
          const zipFileReader = new ZipReader(new BlobReader(new Blob([await Bun.file(archivePath).arrayBuffer()])))
          const entries = await zipFileReader.getEntries()

          // 查找 rg.exe
          let rgEntry: any
          for (const entry of entries) {
            if (entry.filename.endsWith("rg.exe")) {
              rgEntry = entry
              break
            }
          }

          if (!rgEntry) {
            throw new ExtractionFailedError({
              filepath: archivePath,
              stderr: "rg.exe not found in zip archive",
            })
          }

          // 提取 rg.exe
          const rgBlob = await rgEntry.getData(new BlobWriter())
          if (!rgBlob) {
            throw new ExtractionFailedError({
              filepath: archivePath,
              stderr: "Failed to extract rg.exe from zip archive",
            })
          }
          await Bun.write(filepath, await rgBlob.arrayBuffer())
          await zipFileReader.close()
        }
      }

      // 清理归档文件
      await fs.unlink(archivePath)

      // 设置可执行权限（非 Windows）
      if (!platformKey.endsWith("-win32")) await fs.chmod(filepath, 0o755)
    }

    return {
      filepath,
    }
  })

  /**
   * 获取 ripgrep 可执行文件路径
   *
   * @returns Promise，解析为可执行文件的完整路径
   */
  export async function filepath() {
    const { filepath } = await state()
    return filepath
  }

  /**
   * 列出项目中的所有文件
   *
   * 使用 ripgrep 的 --files 模式生成文件列表。
   *
   * @param input - 搜索参数
   *   - cwd：工作目录
   *   - glob：Glob 过滤模式
   *   - hidden：是否包含隐藏文件
   *   - follow：是否跟随符号链接
   *   - maxDepth：最大深度
   * @returns 异步生成器，生成文件路径
   */
  export async function* files(input: {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
  }) {
    // 构建命令参数
    const args = [await filepath(), "--files", "--glob=!.git/*"]
    if (input.follow !== false) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")
    if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)
    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    // 验证工作目录存在（Bun.spawn 的错误报告有问题）
    if (!(await fs.stat(input.cwd).catch(() => undefined))?.isDirectory()) {
      throw Object.assign(new Error(`No such file or directory: '${input.cwd}'`), {
        code: "ENOENT",
        errno: -2,
        path: input.cwd,
      })
    }

    // 启动 ripgrep 进程
    const proc = Bun.spawn(args, {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "ignore",
      maxBuffer: 1024 * 1024 * 20, // 20MB 缓冲区
    })

    // 读取输出
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // 处理 Unix (\n) 和 Windows (\r\n) 行尾
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line) yield line
        }
      }

      // 处理剩余内容
      if (buffer) yield buffer
    } finally {
      reader.releaseLock()
      await proc.exited
    }
  }

  /**
   * 生成目录树的文本表示
   *
   * 列出项目文件并构建树形结构。
   *
   * @param input - 树生成参数
   *   - cwd：工作目录
   *   - limit：最大条目数（默认 50）
   * @returns Promise，解析为目录树文本
   *
   * 树结构规则：
   * - 目录排在文件前面
   * - 同类型按名称排序
   * - 超出限制时显示 [x truncated]
   */
  export async function tree(input: { cwd: string; limit?: number }) {
    log.info("tree", input)

    // 列出所有文件
    const files = await Array.fromAsync(Ripgrep.files({ cwd: input.cwd }))

    // 树节点接口
    interface Node {
      path: string[]
      children: Node[]
    }

    // 获取或创建路径节点
    function getPath(node: Node, parts: string[], create: boolean) {
      if (parts.length === 0) return node
      let current = node
      for (const part of parts) {
        let existing = current.children.find((x) => x.path.at(-1) === part)
        if (!existing) {
          if (!create) return
          existing = {
            path: current.path.concat(part),
            children: [],
          }
          current.children.push(existing)
        }
        current = existing
      }
      return current
    }

    // 构建树结构
    const root: Node = {
      path: [],
      children: [],
    }
    for (const file of files) {
      if (file.includes(".opencode")) continue
      const parts = file.split(path.sep)
      getPath(root, parts, true)
    }

    // 排序节点：目录在前，文件在后，同类型按名称排序
    function sort(node: Node) {
      node.children.sort((a, b) => {
        if (!a.children.length && b.children.length) return 1
        if (!b.children.length && a.children.length) return -1
        return a.path.at(-1)!.localeCompare(b.path.at(-1)!)
      })
      for (const child of node.children) {
        sort(child)
      }
    }
    sort(root)

    // 构建结果树（按层遍历）
    let current = [root]
    const result: Node = {
      path: [],
      children: [],
    }

    let processed = 0
    const limit = input.limit ?? 50

    // 按层处理节点
    while (current.length > 0) {
      const next = []
      for (const node of current) {
        if (node.children.length) next.push(...node.children)
      }
      const max = Math.max(...current.map((x) => x.children.length))

      // 处理当前层的所有节点
      for (let i = 0; i < max && processed < limit; i++) {
        for (const node of current) {
          const child = node.children[i]
          if (!child) continue
          getPath(result, child.path, true)
          processed++
          if (processed >= limit) break
        }
      }

      // 超出限制时添加截断标记
      if (processed >= limit) {
        for (const node of [...current, ...next]) {
          const compare = getPath(result, node.path, false)
          if (!compare) continue
          if (compare?.children.length !== node.children.length) {
            const diff = node.children.length - compare.children.length
            compare.children.push({
              path: compare.path.concat(`[${diff} truncated]`),
              children: [],
            })
          }
        }
        break
      }
      current = next
    }

    // 渲染树为文本
    const lines: string[] = []

    function render(node: Node, depth: number) {
      const indent = "\t".repeat(depth)
      lines.push(indent + node.path.at(-1) + (node.children.length ? "/" : ""))
      for (const child of node.children) {
        render(child, depth + 1)
      }
    }
    result.children.map((x) => render(x, 0))

    return lines.join("\n")
  }

  /**
   * 搜索文件内容
   *
   * 使用 ripgrep 在文件中搜索模式。
   *
   * @param input - 搜索参数
   *   - cwd：工作目录
   *   - pattern：搜索模式
   *   - glob：Glob 过滤模式
   *   - limit：每个文件的最大匹配数
   *   - follow：是否跟随符号链接
   * @returns Promise，解析为匹配数据数组
   */
  export async function search(input: {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
  }) {
    // 构建命令参数
    const args = [`${await filepath()}`, "--json", "--hidden", "--glob='!.git/*'"]
    if (input.follow !== false) args.push("--follow")

    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    if (input.limit) {
      args.push(`--max-count=${input.limit}`)
    }

    args.push("--")
    args.push(input.pattern)

    // 执行搜索
    const command = args.join(" ")
    const result = await $`${{ raw: command }}`.cwd(input.cwd).quiet().nothrow()

    // 搜索失败，返回空数组
    if (result.exitCode !== 0) {
      return []
    }

    // 处理 Unix (\n) 和 Windows (\r\n) 行尾
    const lines = result.text().trim().split(/\r?\n/).filter(Boolean)

    // 解析 ripgrep JSON 输出
    return lines
      .map((line) => JSON.parse(line))
      .map((parsed) => Result.parse(parsed))
      .filter((r) => r.type === "match")
      .map((r) => r.data)
  }
}
