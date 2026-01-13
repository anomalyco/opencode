/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/file
 * ============================================================================
 *
 * 文件作用：
 * 文件操作模块。提供文件读取、列出、搜索、状态查询等功能，支持 Git 差异和二进制文件。
 *
 * 主要功能：
 * - read(file)：读取文件内容，支持 Git diff 和二进制编码
 * - list(dir)：列出目录内容，支持 gitignore
 * - search(input)：模糊搜索文件和目录
 * - status()：获取 Git 状态（修改、添加、删除的文件）
 * - init()：初始化文件缓存
 *
 * 依赖关系：
 * - @/bus/bus-event：事件定义
 * - bun：Bun shell ($) 和文件 API
 * - diff：差异生成（formatPatch, structuredPatch）
 * - path：路径处理
 * - fs：文件系统
 * - ignore：.gitignore 解析
 * - @/util/log：日志
 * - @/util/filesystem：文件系统工具
 * - @/project/instance：实例状态管理
 * - ./ripgrep：Ripgrep 搜索
 * - fuzzysort：模糊搜索
 * - @/global：全局配置
 *
 * 导出内容：
 * - File namespace：文件操作命名空间
 *   - Info：文件信息 Zod schema
 *   - Node：文件节点 Zod schema
 *   - Content：文件内容 Zod schema
 *   - Event：文件事件
 *   - init()：初始化
 *   - status()：获取 Git 状态
 *   - read(file)：读取文件
 *   - list(dir)：列出目录
 *   - search(input)：搜索文件
 *
 * 文件内容类型：
 * - text：文本内容，可选包含 diff 和 patch
 * - base64 编码：二进制文件（图片、音频、视频、字体、压缩包等）
 *
 * Git 支持：
 * - 读取未提交的修改
 * - 显示 unified diff 格式的差异
 * - 检测添加、修改、删除的文件
 * - 支持 .gitignore 和 .ignore
 *
 * @package opencode
 * @module file
 */

// 导入事件定义工具
import { BusEvent } from "@/bus/bus-event"

// 导入 Zod 类型验证库
import z from "zod"

// 导入 Bun shell
import { $ } from "bun"

// 导入 Bun 文件类型
import type { BunFile } from "bun"

// 导入 diff 库，用于生成补丁
import { formatPatch, structuredPatch } from "diff"

// 导入路径处理
import path from "path"

// 导入文件系统
import fs from "fs"

// 导入 ignore 库，用于解析 .gitignore
import ignore from "ignore"

// 导入日志
import { Log } from "../util/log"

// 导入文件系统工具
import { Filesystem } from "../util/filesystem"

// 导入实例状态管理
import { Instance } from "../project/instance"

// 导入 Ripgrep 搜索
import { Ripgrep } from "./ripgrep"

// 导入模糊搜索库
import fuzzysort from "fuzzysort"

// 导入全局配置
import { Global } from "../global"

/**
 * 文件操作命名空间
 *
 * 包含所有文件相关的功能。
 */
export namespace File {
  // 创建文件服务日志记录器
  const log = Log.create({ service: "file" })

  /**
   * 文件信息 Zod Schema
   *
   * 描述 Git 中修改的文件信息。
   */
  export const Info = z
    .object({
      // 文件路径（相对于项目根目录）
      path: z.string(),
      // 添加的行数
      added: z.number().int(),
      // 删除的行数
      removed: z.number().int(),
      // 文件状态
      status: z.enum(["added", "deleted", "modified"]),
    })
    .meta({
      ref: "File",
    })

  export type Info = z.infer<typeof Info>

  /**
   * 文件节点 Zod Schema
   *
   * 描述文件系统中的一个节点（文件或目录）。
   */
  export const Node = z
    .object({
      // 文件/目录名
      name: z.string(),
      // 相对路径
      path: z.string(),
      // 绝对路径
      absolute: z.string(),
      // 类型：文件或目录
      type: z.enum(["file", "directory"]),
      // 是否被忽略（gitignore）
      ignored: z.boolean(),
    })
    .meta({
      ref: "FileNode",
    })
  export type Node = z.infer<typeof Node>

  /**
   * 文件内容 Zod Schema
   *
   * 描述文件读取结果。
   */
  export const Content = z
    .object({
      // 类型：文本
      type: z.literal("text"),
      // 文本内容或 base64 编码内容
      content: z.string(),
      // Git diff（可选）
      diff: z.string().optional(),
      // 结构化 patch（可选）
      patch: z
        .object({
          // 旧文件名
          oldFileName: z.string(),
          // 新文件名
          newFileName: z.string(),
          // 旧文件头（可选）
          oldHeader: z.string().optional(),
          // 新文件头（可选）
          newHeader: z.string().optional(),
          // 差异块列表
          hunks: z.array(
            z.object({
              // 旧文件起始行
              oldStart: z.number(),
              // 旧文件行数
              oldLines: z.number(),
              // 新文件起始行
              newStart: z.number(),
              // 新文件行数
              newLines: z.number(),
              // 差异行
              lines: z.array(z.string()),
            }),
          ),
          // 索引（可选）
          index: z.string().optional(),
        })
        .optional(),
      // 编码方式（base64）
      encoding: z.literal("base64").optional(),
      // MIME 类型
      mimeType: z.string().optional(),
    })
    .meta({
      ref: "FileContent",
    })
  export type Content = z.infer<typeof Content>

  /**
   * 判断文件是否应该编码为 base64
   *
   * 根据文件的 MIME 类型判断是否需要二进制编码。
   *
   * @param file - Bun 文件对象
   * @returns Promise，如果是二进制文件返回 true
   *
   * 编码规则：
   * - text/*：不编码（文本文件）
   * - 包含 charset=：不编码（文本编码）
   * - image/*、audio/*、video/*、font/*、model/*、multipart/*：编码
   * - 特定二进制类型：zip、gzip、pdf、msword、excel 等：编码
   */
  async function shouldEncode(file: BunFile): Promise<boolean> {
    // 获取 MIME 类型并转为小写
    const type = file.type?.toLowerCase()
    log.info("shouldEncode", { type })

    // 如果没有类型信息，不编码
    if (!type) return false

    // 文本类型不需要编码
    if (type.startsWith("text/")) return false

    // 包含字符集的不需要编码
    if (type.includes("charset=")) return false

    // 解析 MIME 类型：top/sub
    const parts = type.split("/", 2)
    const top = parts[0]
    const rest = parts[1] ?? ""
    const sub = rest.split(";", 1)[0]  // 去除参数

    // 明确的二进制顶级类型
    const tops = ["image", "audio", "video", "font", "model", "multipart"]
    if (tops.includes(top)) return true

    // 明确的二进制子类型
    const bins = [
      "zip",      // ZIP 压缩包
      "gzip",     // GZIP 压缩
      "bzip",     // BZIP 压缩
      "compressed", // 压缩文件
      "binary",   // 二进制
      "pdf",      // PDF 文档
      "msword",   // Word 文档
      "powerpoint", // PowerPoint 文档
      "excel",    // Excel 文档
      "ogg",      // OGG 音频
      "exe",      // Windows 可执行文件
      "dmg",      // macOS 磁盘镜像
      "iso",      // ISO 镜像
      "rar",      // RAR 压缩包
    ]
    if (bins.some((mark) => sub.includes(mark))) return true

    // 默认不编码
    return false
  }

  /**
   * 文件事件
   *
   * 定义文件相关的事件类型。
   */
  export const Event = {
    /**
     * 文件已编辑事件
     *
     * 当文件被编辑时触发。
     */
    Edited: BusEvent.define(
      "file.edited",
      z.object({
        // 文件路径
        file: z.string(),
      }),
    ),
  }

  /**
   * 文件缓存状态
   *
   * 使用 Instance.state() 创建响应式状态。
   * 缓存项目中的所有文件和目录列表。
   *
   * 状态结构：
   * - files：文件路径列表
   * - dirs：目录路径列表（以 / 结尾）
   * - fetching：是否正在获取
   * - cache：当前缓存
   *
   * 全局项目特殊处理：
   * - 在用户主目录时，只显示顶级目录和二级目录
   * - 忽略隐藏目录和特定目录（Library, AppData）
   * - 忽略常见的构建目录（node_modules, dist, build, target, vendor）
   */
  const state = Instance.state(async () => {
    // 条目类型定义
    type Entry = { files: string[]; dirs: string[] }

    // 初始化缓存
    let cache: Entry = { files: [], dirs: [] }

    // 是否正在获取
    let fetching = false

    // 检查是否在全局主目录
    const isGlobalHome = Instance.directory === Global.Path.home && Instance.project.id === "global"

    /**
     * 扫描文件和目录
     */
    const fn = async (result: Entry) => {
      // 如果在文件系统根目录，禁用扫描
      if (Instance.directory === path.parse(Instance.directory).root) return

      // 标记正在获取
      fetching = true

      // 全局主目录的特殊处理
      if (isGlobalHome) {
        const dirs = new Set<string>()
        const ignore = new Set<string>()

        // 平台特定的忽略目录
        if (process.platform === "darwin") ignore.add("Library")
        if (process.platform === "win32") ignore.add("AppData")

        // 嵌套目录忽略列表
        const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])

        // 顶级目录判断函数
        const shouldIgnore = (name: string) => name.startsWith(".") || ignore.has(name)

        // 嵌套目录判断函数
        const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)

        // 读取顶级目录
        const top = await fs.promises
          .readdir(Instance.directory, { withFileTypes: true })
          .catch(() => [] as fs.Dirent[])

        // 遍历顶级目录
        for (const entry of top) {
          if (!entry.isDirectory()) continue
          if (shouldIgnore(entry.name)) continue

          // 添加顶级目录
          dirs.add(entry.name + "/")

          // 读取二级目录
          const base = path.join(Instance.directory, entry.name)
          const children = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => [] as fs.Dirent[])

          for (const child of children) {
            if (!child.isDirectory()) continue
            if (shouldIgnoreNested(child.name)) continue

            // 添加二级目录
            dirs.add(entry.name + "/" + child.name + "/")
          }
        }

        // 更新结果
        result.dirs = Array.from(dirs).toSorted()
        cache = result
        fetching = false
        return
      }

      // 常规项目：使用 Ripgrep 扫描文件
      const set = new Set<string>()

      // 遍历 Ripgrep 返回的文件
      for await (const file of Ripgrep.files({ cwd: Instance.directory })) {
        // 添加文件
        result.files.push(file)

        // 提取所有父目录
        let current = file
        while (true) {
          const dir = path.dirname(current)
          if (dir === ".") break
          if (dir === current) break
          current = dir
          if (set.has(dir)) continue
          set.add(dir)
          result.dirs.push(dir + "/")
        }
      }

      // 更新缓存
      cache = result
      fetching = false
    }

    // 启动初始扫描
    fn(cache)

    return {
      // 获取文件和目录列表
      async files() {
        // 如果没有正在获取，触发新的扫描
        if (!fetching) {
          fn({
            files: [],
            dirs: [],
          })
        }
        // 返回缓存
        return cache
      },
    }
  })

  /**
   * 初始化文件缓存
   *
   * 触发初始文件扫描。
   */
  export function init() {
    state()
  }

  /**
   * 获取 Git 状态
   *
   * 返回所有修改、添加和删除的文件。
   *
   * @returns Promise，解析为文件信息列表
   *
   * 返回的文件状态：
   * - modified：已修改的文件（包含行数变化）
   * - added：新增的文件（包含行数）
   * - deleted：删除的文件
   *
   * Git 命令：
   * - git diff --numstat HEAD：获取修改的文件和行数变化
   * - git ls-files --others --exclude-standard：获取未跟踪的文件
   * - git diff --name-only --diff-filter=D HEAD：获取删除的文件
   */
  export async function status() {
    const project = Instance.project

    // 如果不是 Git 项目，返回空列表
    if (project.vcs !== "git") return []

    // 获取修改的文件（包含行数变化）
    const diffOutput = await $`git diff --numstat HEAD`.cwd(Instance.directory).quiet().nothrow().text()

    const changedFiles: Info[] = []

    // 解析 --numstat 输出：格式为 "添加\t删除\t文件路径"
    if (diffOutput.trim()) {
      const lines = diffOutput.trim().split("\n")
      for (const line of lines) {
        const [added, removed, filepath] = line.split("\t")
        changedFiles.push({
          path: filepath,
          // "-" 表示二进制文件，计为 0
          added: added === "-" ? 0 : parseInt(added, 10),
          removed: removed === "-" ? 0 : parseInt(removed, 10),
          status: "modified",
        })
      }
    }

    // 获取未跟踪的文件
    const untrackedOutput = await $`git ls-files --others --exclude-standard`
      .cwd(Instance.directory)
      .quiet()
      .nothrow()
      .text()

    if (untrackedOutput.trim()) {
      const untrackedFiles = untrackedOutput.trim().split("\n")
      for (const filepath of untrackedFiles) {
        try {
          // 读取文件内容以计算行数
          const content = await Bun.file(path.join(Instance.directory, filepath)).text()
          const lines = content.split("\n").length
          changedFiles.push({
            path: filepath,
            added: lines,
            removed: 0,
            status: "added",
          })
        } catch {
          // 文件读取失败，跳过
          continue
        }
      }
    }

    // 获取删除的文件
    const deletedOutput = await $`git diff --name-only --diff-filter=D HEAD`
      .cwd(Instance.directory)
      .quiet()
      .nothrow()
      .text()

    if (deletedOutput.trim()) {
      const deletedFiles = deletedOutput.trim().split("\n")
      for (const filepath of deletedFiles) {
        changedFiles.push({
          path: filepath,
          added: 0,
          removed: 0,  // 可以获取原始行数，但需要额外的 git 命令
          status: "deleted",
        })
      }
    }

    // 转换为相对路径
    return changedFiles.map((x) => ({
      ...x,
      path: path.relative(Instance.directory, x.path),
    }))
  }

  /**
   * 读取文件内容
   *
   * 读取文件并返回内容。对于 Git 中的文件，还会生成 diff 和 patch。
   *
   * @param file - 文件路径（相对于项目根目录）
   * @returns Promise，解析为文件内容
   *
   * 安全检查：
   * - 验证路径是否在项目目录内
   *
   * 返回内容：
   * - 文本文件：content 包含文本内容
   * - 二进制文件：content 包含 base64 编码，mimetype 包含 MIME 类型
   * - Git 修改文件：额外包含 diff 和 patch
   */
  export async function read(file: string): Promise<Content> {
    // 计时日志
    using _ = log.time("read", { file })
    const project = Instance.project
    const full = path.join(Instance.directory, file)

    // 安全检查：确保路径在项目目录内
    // 注意：Filesystem.contains 只是词法检查 - 项目内的符号链接可能逃逸
    // 注意：在 Windows 上，跨驱动器路径绕过此检查。考虑 realpath 规范化
    if (!Instance.containsPath(full)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    // 获取 Bun 文件对象
    const bunFile = Bun.file(full)

    // 如果文件不存在，返回空内容
    if (!(await bunFile.exists())) {
      return { type: "text", content: "" }
    }

    // 判断是否需要编码
    const encode = await shouldEncode(bunFile)

    // 处理二进制文件
    if (encode) {
      // 读取文件并转换为 base64
      const buffer = await bunFile.arrayBuffer().catch(() => new ArrayBuffer(0))
      const content = Buffer.from(buffer).toString("base64")
      const mimeType = bunFile.type || "application/octet-stream"
      return { type: "text", content, mimeType, encoding: "base64" }
    }

    // 读取文本内容
    const content = await bunFile
      .text()
      .catch(() => "")
      .then((x) => x.trim())

    // 如果是 Git 项目，尝试生成 diff 和 patch
    if (project.vcs === "git") {
      // 获取工作区的修改
      let diff = await $`git diff ${file}`.cwd(Instance.directory).quiet().nothrow().text()

      // 如果没有工作区修改，获取暂存区的修改
      if (!diff.trim()) diff = await $`git diff --staged ${file}`.cwd(Instance.directory).quiet().nothrow().text()

      // 如果有修改，生成 patch
      if (diff.trim()) {
        // 获取原始内容（HEAD 版本）
        const original = await $`git show HEAD:${file}`.cwd(Instance.directory).quiet().nothrow().text()

        // 生成结构化 patch
        const patch = structuredPatch(file, file, original, content, "old", "new", {
          context: Infinity,         // 完整上下文
          ignoreWhitespace: true,    // 忽略空白字符差异
        })

        // 格式化 patch
        const diff = formatPatch(patch)
        return { type: "text", content, patch, diff }
      }
    }

    // 返回纯文本内容
    return { type: "text", content }
  }

  /**
   * 列出目录内容
   *
   * 列出指定目录中的文件和子目录。
   *
   * @param dir - 目录路径（相对于项目根目录，可选）
   * @returns Promise，解析为文件节点列表
   *
   * 特性：
   * - 支持绝对路径安全检查
   * - 遵循 .gitignore 和 .ignore
   * - 排除 .git 和 .DS_Store
   * - 目录排在文件前面
   * - 按名称排序
   */
  export async function list(dir?: string) {
    // 默认排除的文件/目录
    const exclude = [".git", ".DS_Store"]
    const project = Instance.project

    // 默认不忽略任何文件
    let ignored = (_: string) => false

    // 如果是 Git 项目，解析 .gitignore 和 .ignore
    if (project.vcs === "git") {
      const ig = ignore()

      // 读取 .gitignore
      const gitignore = Bun.file(path.join(Instance.worktree, ".gitignore"))
      if (await gitignore.exists()) {
        ig.add(await gitignore.text())
      }

      // 读取 .ignore
      const ignoreFile = Bun.file(path.join(Instance.worktree, ".ignore"))
      if (await ignoreFile.exists()) {
        ig.add(await ignoreFile.text())
      }

      // 创建忽略检查函数
      ignored = ig.ignores.bind(ig)
    }

    // 解析完整路径
    const resolved = dir ? path.join(Instance.directory, dir) : Instance.directory

    // 安全检查：确保路径在项目目录内
    // 注意：Filesystem.contains 只是词法检查 - 项目内的符号链接可能逃逸
    // 注意：在 Windows 上，跨驱动器路径绕过此检查。考虑 realpath 规范化
    if (!Instance.containsPath(resolved)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    // 读取目录
    const nodes: Node[] = []
    for (const entry of await fs.promises
      .readdir(resolved, {
        withFileTypes: true,
      })
      .catch(() => [])) {
      // 跳过排除的文件
      if (exclude.includes(entry.name)) continue

      const fullPath = path.join(resolved, entry.name)
      const relativePath = path.relative(Instance.directory, fullPath)
      const type = entry.isDirectory() ? "directory" : "file"

      nodes.push({
        name: entry.name,
        path: relativePath,
        absolute: fullPath,
        type,
        // 目录路径以 / 结尾用于匹配 ignore 规则
        ignored: ignored(type === "directory" ? relativePath + "/" : relativePath),
      })
    }

    // 排序：目录在前，然后按名称排序
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * 搜索文件和目录
   *
   * 使用模糊搜索查找匹配的文件和目录。
   *
   * @param input - 搜索参数
   *   - query：搜索查询
   *   - limit：结果限制（默认 100）
   *   - dirs：是否包含目录（默认 true）
   *   - type：文件类型过滤（"file" | "directory" | "all"）
   * @returns Promise，解析为匹配的路径列表
   *
   * 特性：
   * - 使用 fuzzysort 进行模糊搜索
   * - 隐藏文件/目录默认排在最后（除非查询包含 .）
   * - 目录搜索使用更大的限制（limit * 20）
   */
  export async function search(input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) {
    // 清理查询
    const query = input.query.trim()
    const limit = input.limit ?? 100

    // 确定搜索类型
    const kind = input.type ?? (input.dirs === false ? "file" : "all")
    log.info("search", { query, kind })

    // 获取缓存
    const result = await state().then((x) => x.files())

    // 判断是否是隐藏文件/目录
    const hidden = (item: string) => {
      const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
      return normalized.split("/").some((p) => p.startsWith(".") && p.length > 1)
    }

    // 如果查询包含 .，优先显示隐藏文件
    const preferHidden = query.startsWith(".") || query.includes("/.")

    // 将隐藏项排序到后面
    const sortHiddenLast = (items: string[]) => {
      if (preferHidden) return items
      const visible: string[] = []
      const hiddenItems: string[] = []
      for (const item of items) {
        const isHidden = hidden(item)
        if (isHidden) hiddenItems.push(item)
        if (!isHidden) visible.push(item)
      }
      return [...visible, ...hiddenItems]
    }

    // 空查询：返回前 N 项
    if (!query) {
      if (kind === "file") return result.files.slice(0, limit)
      return sortHiddenLast(result.dirs.toSorted()).slice(0, limit)
    }

    // 选择搜索目标
    const items =
      kind === "file" ? result.files : kind === "directory" ? result.dirs : [...result.files, ...result.dirs]

    // 目录搜索使用更大的限制
    const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit

    // 执行模糊搜索
    const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((r) => r.target)

    // 应用排序和限制
    const output = kind === "directory" ? sortHiddenLast(sorted).slice(0, limit) : sorted

    log.info("search", { query, kind, results: output.length })
    return output
  }
}
