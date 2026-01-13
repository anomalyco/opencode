/**
 * ============================================================================
 * 文件名：config.ts
 * 所属包：packages/opencode/src/config
 * ============================================================================
 *
 * 文件作用：
 * 配置系统模块。提供多层级配置加载、合并和管理功能。
 *
 * 主要功能：
 * - state()：加载和合并所有配置源
 * - loadFile()：加载单个配置文件
 * - load()：解析配置内容（支持 JSONC 和变量替换）
 * - global()：加载全局用户配置
 * - update()：更新配置
 * - get()：获取当前配置
 * - directories()：获取配置目录列表
 * - installDependencies()：安装配置目录的依赖
 * - loadCommand()：加载命令定义
 * - loadAgent()：加载 Agent 定义
 * - loadPlugin()：加载插件定义
 * - getPluginName()：提取插件名称
 * - deduplicatePlugins()：去重插件列表
 *
 * 依赖关系：
 * - ../util/log：日志记录
 * - path：路径处理
 * - url：URL 处理（pathToFileURL）
 * - os：操作系统信息
 * - zod：类型验证
 * - ../util/filesystem：文件系统工具
 * - ../provider/models：模型定义
 * - remeda：工具函数（mergeDeep, pipe, unique）
 * - ../global：全局路径配置
 * - fs/promises：异步文件操作
 * - ../util/lazy：惰性初始化
 * - @opencode-ai/util/error：错误处理
 * - ../flag/flag：命令行标志
 * - ../auth：认证信息
 * - jsonc-parser：JSONC 解析
 * - ../project/instance：实例管理
 * - ../lsp/server：LSP 服务器定义
 * - @/bun：Bun 进程管理
 * - @/installation：安装信息
 * - ./markdown：Markdown 配置解析
 *
 * 导出内容：
 * - Config namespace：配置命名空间
 *   - Info Schema：配置类型定义
 *   - Agent Schema：Agent 配置类型
 *   - Command Schema：命令配置类型
 *   - Mcp Schema：MCP 服务器配置类型
 *   - Permission Schema：权限配置类型
 *   - Provider Schema：提供商配置类型
 *   - Server Schema：服务器配置类型
 *   - Keybinds Schema：快捷键配置类型
 *   - TUI Schema：TUI 配置类型
 *   - state()：配置状态（惰性加载）
 *   - get()：获取当前配置
 *   - update(config)：更新配置
 *   - directories()：获取配置目录列表
 *   - global()：全局配置（惰性加载）
 *   - installDependencies(dir)：安装依赖
 *   - getPluginName(plugin)：提取插件名称
 *   - deduplicatePlugins(plugins)：去重插件
 *   - JsonError：JSON 解析错误
 *   - ConfigDirectoryTypoError：配置目录拼写错误
 *   - InvalidError：无效配置错误
 *
 * 配置加载优先级（从低到高）：
 * 1. Remote/Well-known 配置（从认证服务器获取）
 * 2. 全局用户配置（~/.config/opencode/）
 * 3. 自定义配置路径（OPENCODE_CONFIG 标志）
 * 4. 项目配置（opencode.jsonc/json）
 * 5. 内联配置内容（OPENCODE_CONFIG_CONTENT 标志）
 * 6. .opencode 目录配置（从工作树向上查找）
 *
 * 特殊功能：
 * - JSONC 支持（注释、尾随逗号）
 * - 环境变量替换：{env:VAR_NAME}
 * - 文件内容包含：{file:path/to/file}
 * - 命令、Agent、插件从 Markdown 文件加载
 * - 向后兼容性处理（tools -> permission, mode -> agent）
 *
 * 使用示例：
 * ```typescript
 * // 获取当前配置
 * const config = await Config.get()
 *
 * // 读取特定字段
 * const model = config.model  // "anthropic/claude-3-opus-20240229"
 *
 * // 更新配置
 * await Config.update({ model: "openai/gpt-4" })
 *
 * // 获取配置目录列表
 * const dirs = await Config.directories()
 * ```
 *
 * @package opencode
 * @module config
 */

// 导入日志模块
import { Log } from "../util/log"

// 导入路径处理模块
import path from "path"

// 导入 URL 处理模块（将路径转换为 file:// URL）
import { pathToFileURL } from "url"

// 导入操作系统信息模块
import os from "os"

// 导入 Zod 类型验证库
import z from "zod"

// 导入文件系统工具
import { Filesystem } from "../util/filesystem"

// 导入模型定义（Provider 和 Model 类型）
import { ModelsDev } from "../provider/models"

// 导入 Remeda 工具函数
import { mergeDeep, pipe, unique } from "remeda"

// 导入全局路径配置
import { Global } from "../global"

// 导入异步文件操作
import fs from "fs/promises"

// 导入惰性初始化工具
import { lazy } from "../util/lazy"

// 导入命名错误创建工具
import { NamedError } from "@opencode-ai/util/error"

// 导入标志解析模块
import { Flag } from "../flag/flag"

// 导入认证信息模块
import { Auth } from "../auth"

// 导入 JSONC 解析器
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"

// 导入实例管理模块
import { Instance } from "../project/instance"

// 导入 LSP 服务器定义
import { LSPServer } from "../lsp/server"

// 导入 Bun 进程管理
import { BunProc } from "@/bun"

// 导入安装信息模块
import { Installation } from "@/installation"

// 导入 Markdown 配置解析器
import { ConfigMarkdown } from "./markdown"

// 导入文件存在性检查函数
import { existsSync } from "fs"

/**
 * 配置命名空间
 *
 * 提供配置加载、合并和管理功能。
 */
export namespace Config {
  // 创建日志记录器
  const log = Log.create({ service: "config" })

  /**
   * 自定义配置合并函数
   *
   * 与默认的 mergeDeep 不同，这个函数在合并时会**连接数组字段**
   * 而不是替换它们。这对于 plugin 和 instructions 字段特别重要，
   * 因为我们希望将不同来源的配置累积起来，而不是只用最后一个。
   *
   * @param target - 目标配置对象（基础配置）
   * @param source - 源配置对象（要合并的配置）
   * @returns 合并后的配置对象
   *
   * 合并逻辑：
   * 1. 使用 mergeDeep 进行标准深度合并
   * 2. 对于 plugin 字段：将两个数组合并并去重
   * 3. 对于 instructions 字段：将两个数组合并并去重
   *
   * @example
   * ```typescript
   * const target = { plugin: ["a", "b"], instructions: ["x"] }
   * const source = { plugin: ["b", "c"], instructions: ["y"] }
   * const merged = mergeConfigConcatArrays(target, source)
   * // merged.plugin = ["a", "b", "c"]
   * // merged.instructions = ["x", "y"]
   * ```
   */
  function mergeConfigConcatArrays(target: Info, source: Info): Info {
    // 首先执行标准的深度合并
    const merged = mergeDeep(target, source)

    // 如果两边都有 plugin 配置，合并并去重
    if (target.plugin && source.plugin) {
      // 使用 Set 去重，然后转回数组
      merged.plugin = Array.from(new Set([...target.plugin, ...source.plugin]))
    }

    // 如果两边都有 instructions 配置，合并并去重
    if (target.instructions && source.instructions) {
      merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
    }

    // 返回合并后的配置
    return merged
  }

  /**
   * 配置状态（惰性加载）
   *
   * 使用 Instance.state 创建一个在实例生命周期内缓存的配置。
   * 首次访问时会加载所有配置，后续访问直接返回缓存值。
   *
   * 加载流程：
   * 1. 获取认证信息（用于 Well-known 配置）
   * 2. 加载远程/Well-known 配置（最低优先级）
   * 3. 加载全局用户配置
   * 4. 加载自定义配置路径（OPENCODE_CONFIG）
   * 5. 加载项目配置（opencode.jsonc/json）
   * 6. 加载内联配置（OPENCODE_CONFIG_CONTENT）
   * 7. 加载 .opencode 目录配置
   * 8. 应用向后兼容性转换
   * 9. 应用标志覆盖
   *
   * 返回值：
   * - config：合并后的完整配置
   * - directories：配置目录列表
   */
  export const state = Instance.state(async () => {
    // 第一步：获取所有认证信息
    // 用于加载 Well-known 远程配置
    const auth = await Auth.all()

    // 第二步：初始化结果为空对象
    // 将按优先级从低到高逐步合并配置
    let result: Info = {}

    // 第三步：加载远程/Well-known 配置（最低优先级）
    // 这允许组织提供用户可以覆盖的默认配置
    for (const [key, value] of Object.entries(auth)) {
      // 只处理 Well-known 类型的认证
      if (value.type === "wellknown") {
        // 将认证 token 设置为环境变量
        // 配置文件可能引用这些变量
        process.env[value.key] = value.token

        // 记录正在获取远程配置
        log.debug("fetching remote config", { url: `${key}/.well-known/opencode` })

        // 从 Well-known 端点获取配置
        const response = await fetch(`${key}/.well-known/opencode`)

        // 检查响应是否成功
        if (!response.ok) {
          throw new Error(`failed to fetch remote config from ${key}: ${response.status}`)
        }

        // 解析响应 JSON
        const wellknown = (await response.json()) as any
        const remoteConfig = wellknown.config ?? {}

        // 添加 $schema 字段，防止 load() 尝试写回不存在的文件
        if (!remoteConfig.$schema) remoteConfig.$schema = "https://opencode.ai/config.json"

        // 将远程配置合并到结果中
        result = mergeConfigConcatArrays(
          result, // 当前结果
          await load(JSON.stringify(remoteConfig), `${key}/.well-known/opencode`), // 加载的远程配置
        )

        // 记录成功加载
        log.debug("loaded remote config from well-known", { url: key })
      }
    }

    // 第四步：加载全局用户配置（覆盖远程配置）
    result = mergeConfigConcatArrays(result, await global())

    // 第五步：加载自定义配置路径（覆盖全局配置）
    if (Flag.OPENCODE_CONFIG) {
      result = mergeConfigConcatArrays(result, await loadFile(Flag.OPENCODE_CONFIG))
      log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
    }

    // 第六步：加载项目配置（覆盖全局和远程配置）
    // 按顺序查找 opencode.jsonc 和 opencode.json
    for (const file of ["opencode.jsonc", "opencode.json"]) {
      // 从实例目录向上查找配置文件
      const found = await Filesystem.findUp(file, Instance.directory, Instance.worktree)

      // 反转数组以从最近到最远处理（子目录优先）
      for (const resolved of found.toReversed()) {
        result = mergeConfigConcatArrays(result, await loadFile(resolved))
      }
    }

    // 第七步：加载内联配置内容（最高优先级）
    if (Flag.OPENCODE_CONFIG_CONTENT) {
      result = mergeConfigConcatArrays(result, JSON.parse(Flag.OPENCODE_CONFIG_CONTENT))
      log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
    }

    // 第八步：初始化嵌套对象（防止 undefined 错误）
    result.agent = result.agent || {}
    result.mode = result.mode || {}
    result.plugin = result.plugin || []

    // 第九步：收集配置目录列表
    // 用于后续加载命令、Agent 和插件
    const directories = [
      // 全局配置目录
      Global.Path.config,
      // 从实例目录向上查找的 .opencode 目录
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".opencode"],
          start: Instance.directory,
          stop: Instance.worktree,
        }),
      )),
      // 从用户主目录查找的 .opencode 目录
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".opencode"],
          start: Global.Path.home,
          stop: Global.Path.home,
        }),
      )),
    ]

    // 第十步：添加自定义配置目录（如果指定）
    if (Flag.OPENCODE_CONFIG_DIR) {
      directories.push(Flag.OPENCODE_CONFIG_DIR)
      log.debug("loading config from OPENCODE_CONFIG_DIR", { path: Flag.OPENCODE_CONFIG_DIR })
    }

    // 第十一步：遍历所有配置目录，加载特定配置
    for (const dir of unique(directories)) {
      // 只处理 .opencode 目录或自定义配置目录
      if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {
        // 尝试加载 opencode.jsonc 和 opencode.json
        for (const file of ["opencode.jsonc", "opencode.json"]) {
          log.debug(`loading config from ${path.join(dir, file)}`)
          result = mergeConfigConcatArrays(result, await loadFile(path.join(dir, file)))
          // 满足类型检查器（确保这些字段不是 undefined）
          result.agent ??= {}
          result.mode ??= {}
          result.plugin ??= []
        }
      }

      // 检查 node_modules 是否存在
      const exists = existsSync(path.join(dir, "node_modules"))

      // 启动依赖安装（不等待完成）
      const installing = installDependencies(dir)

      // 如果 node_modules 不存在，等待安装完成
      if (!exists) await installing

      // 从目录加载命令定义
      result.command = mergeDeep(result.command ?? {}, await loadCommand(dir))

      // 从目录加载 Agent 定义
      result.agent = mergeDeep(result.agent, await loadAgent(dir))

      // 从目录加载 Mode 定义（转换为 Agent）
      result.agent = mergeDeep(result.agent, await loadMode(dir))

      // 从目录加载插件定义
      result.plugin.push(...(await loadPlugin(dir)))
    }

    // 第十二步：迁移废弃的 mode 字段到 agent 字段
    // 向后兼容：将 mode 转换为 agent
    for (const [name, mode] of Object.entries(result.mode)) {
      result.agent = mergeDeep(result.agent ?? {}, {
        [name]: {
          ...mode, // 保留所有 mode 属性
          mode: "primary" as const, // 标记为主 agent
        },
      })
    }

    // 第十三步：应用权限标志覆盖
    if (Flag.OPENCODE_PERMISSION) {
      result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.OPENCODE_PERMISSION))
    }

    // 第十四步：向后兼容：处理顶层的 tools 配置
    // 将旧的 tools 字段转换为 permission 字段
    if (result.tools) {
      // 创建权限映射
      const perms: Record<string, Config.PermissionAction> = {}

      // 遍历所有工具配置
      for (const [tool, enabled] of Object.entries(result.tools)) {
        // 将布尔值转换为权限动作
        const action: Config.PermissionAction = enabled ? "allow" : "deny"

        // 特殊处理：write/edit/patch/multiedit 都映射到 edit 权限
        if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
          perms.edit = action
          continue
        }

        // 其他工具直接映射
        perms[tool] = action
      }

      // 合并到现有权限配置（tools 优先）
      result.permission = mergeDeep(perms, result.permission ?? {})
    }

    // 第十五步：设置默认用户名
    if (!result.username) result.username = os.userInfo().username

    // 第十六步：处理 autoshare 到 share 字段的迁移
    if (result.autoshare === true && !result.share) {
      result.share = "auto"
    }

    // 第十七步：设置默认快捷键配置
    if (!result.keybinds) result.keybinds = Info.shape.keybinds.parse({})

    // 第十八步：应用标志覆盖（压缩设置）
    if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) {
      result.compaction = { ...result.compaction, auto: false }
    }
    if (Flag.OPENCODE_DISABLE_PRUNE) {
      result.compaction = { ...result.compaction, prune: false }
    }

    // 第十九步：去重插件列表
    result.plugin = deduplicatePlugins(result.plugin ?? [])

    // 第二十步：返回配置状态
    return {
      config: result, // 完整的配置对象
      directories, // 配置目录列表
    }
  })

  /**
   * 安装配置目录的依赖
   *
   * 确保配置目录有必要的 package.json 和依赖项。
   * 主要用于支持本地插件和自定义工具使用外部包。
   *
   * @param dir - 配置目录路径
   * @returns Promise，完成时依赖已安装
   *
   * 处理流程：
   * 1. 确保 package.json 存在
   * 2. 创建 .gitignore 文件（如果不存在）
   * 3. 安装 @opencode-ai/plugin 包
   * 4. 安装其他依赖（package.json 中定义的）
   *
   * @example
   * ```typescript
   * await Config.installDependencies("~/.config/opencode")
   * ```
   */
  export async function installDependencies(dir: string) {
    // 构造 package.json 路径
    const pkg = path.join(dir, "package.json")

    // 确保 package.json 存在
    if (!(await Bun.file(pkg).exists())) {
      // 创建空的 package.json
      await Bun.write(pkg, "{}")
    }

    // 构造 .gitignore 路径
    const gitignore = path.join(dir, ".gitignore")

    // 检查 .gitignore 是否存在
    const hasGitIgnore = await Bun.file(gitignore).exists()

    // 如果不存在，创建默认的 .gitignore
    if (!hasGitIgnore) {
      await Bun.write(
        gitignore,
        // 忽略：node_modules、package.json、bun.lock、.gitignore
        ["node_modules", "package.json", "bun.lock", ".gitignore"].join("\n"),
      )
    }

    // 安装 @opencode-ai/plugin 包
    // 使用本地版本（如果正在开发）或发布版本
    await BunProc.run(
      ["add", "@opencode-ai/plugin@" + (Installation.isLocal() ? "latest" : Installation.VERSION), "--exact"],
      {
        cwd: dir, // 在指定目录中运行
      },
    ).catch(() => {}) // 忽略错误

    // 安装 package.json 中定义的其他依赖
    // 这允许本地插件和自定义工具使用外部包
    await BunProc.run(["install"], { cwd: dir }).catch(() => {})
  }

  /**
   * 从相对路径模式中提取文件相对路径
   *
   * 用于将配置文件中的绝对路径转换为相对于配置目录的路径。
   *
   * @param item - 绝对路径
   * @param patterns - 要匹配的模式列表
   * @returns 相对路径（如果匹配），否则返回 undefined
   *
   * @example
   * ```typescript
   * rel("/home/user/.opencode/command/test.md", ["/.opencode/command/"])
   * // 返回 "test.md"
   * ```
   */
  function rel(item: string, patterns: string[]) {
    // 遍历所有模式
    for (const pattern of patterns) {
      // 查找模式在路径中的位置
      const index = item.indexOf(pattern)
      if (index === -1) continue // 没有匹配，继续下一个模式

      // 返回匹配项之后的部分（相对路径）
      return item.slice(index + pattern.length)
    }
  }

  /**
   * 移除文件扩展名
   *
   * @param file - 文件路径
   * @returns 不带扩展名的文件路径
   *
   * @example
   * ```typescript
   * trim("/path/to/test.md")  // "/path/to/test"
   * trim("/path/to/test")     // "/path/to/test"
   * ```
   */
  function trim(file: string) {
    // 获取文件扩展名
    const ext = path.extname(file)

    // 如果有扩展名，移除它；否则返回原路径
    return ext.length ? file.slice(0, -ext.length) : file
  }

  /**
   * 命令文件的 Glob 模式
   *
   * 匹配 command/ 或 commands/ 目录下的所有 .md 文件。
   */
  const COMMAND_GLOB = new Bun.Glob("{command,commands}/**/*.md")

  /**
   * 加载目录中的命令定义
   *
   * 从 command/ 或 commands/ 目录中加载 Markdown 格式的命令定义。
   *
   * @param dir - 配置目录路径
   * @returns Promise，解析为命令名称到命令配置的映射
   *
   * 处理流程：
   * 1. 扫描命令目录中的所有 .md 文件
   * 2. 解析每个文件的 frontmatter 和内容
   * 3. 提取命令名称（文件名，不含扩展名）
   * 4. 验证命令配置
   * 5. 返回命令映射
   *
   * Markdown 格式：
   * ```markdown
   * ---
   * description: 命令描述
   * agent: 使用的 agent
   * model: 使用的模型
   * ---
   *
   * 命令模板内容...
   * ```
   */
  async function loadCommand(dir: string) {
    // 存储命令映射
    const result: Record<string, Command> = {}

    // 扫描命令目录中的所有 .md 文件
    for await (const item of COMMAND_GLOB.scan({
      absolute: true, // 返回绝对路径
      followSymlinks: true, // 跟随符号链接
      dot: true, // 包含隐藏文件
      cwd: dir, // 在指定目录中扫描
    })) {
      // 解析 Markdown 文件
      const md = await ConfigMarkdown.parse(item)
      if (!md.data) continue // 没有 frontmatter，跳过

      // 提取相对路径的模式列表
      const patterns = [
        "/.opencode/command/",
        "/.opencode/commands/",
        "/command/",
        "/commands/",
      ]

      // 获取相对路径或文件名
      const file = rel(item, patterns) ?? path.basename(item)

      // 移除扩展名得到命令名称
      const name = trim(file)

      // 构造命令配置
      const config = {
        name, // 命令名称
        ...md.data, // frontmatter 中的配置
        template: md.content.trim(), // Markdown 内容作为模板
      }

      // 验证命令配置
      const parsed = Command.safeParse(config)
      if (parsed.success) {
        // 验证成功，添加到结果
        result[config.name] = parsed.data
        continue
      }

      // 验证失败，抛出错误
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }

    return result
  }

  /**
   * Agent 文件的 Glob 模式
   *
   * 匹配 agent/ 或 agents/ 目录下的所有 .md 文件。
   */
  const AGENT_GLOB = new Bun.Glob("{agent,agents}/**/*.md")

  /**
   * 加载目录中的 Agent 定义
   *
   * 从 agent/ 或 agents/ 目录中加载 Markdown 格式的 Agent 定义。
   *
   * @param dir - 配置目录路径
   * @returns Promise，解析为 Agent 名称到配置的映射
   *
   * 处理流程：
   * 1. 扫描 agent 目录中的所有 .md 文件
   * 2. 解析每个文件的 frontmatter 和内容
   * 3. 提取 Agent 名称（文件名，不含扩展名）
   * 4. 验证 Agent 配置
   * 5. 返回 Agent 映射
   *
   * Markdown 格式：
   * ```markdown
   * ---
   * model: anthropic/claude-3-opus-20240229
   * description: Agent 描述
   * temperature: 0.7
   * ---
   *
   * Agent 系统提示词...
   * ```
   */
  async function loadAgent(dir: string) {
    // 存储 Agent 映射
    const result: Record<string, Agent> = {}

    // 扫描 agent 目录中的所有 .md 文件
    for await (const item of AGENT_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      // 解析 Markdown 文件
      const md = await ConfigMarkdown.parse(item)
      if (!md.data) continue

      // 提取相对路径的模式列表
      const patterns = [
        "/.opencode/agent/",
        "/.opencode/agents/",
        "/agent/",
        "/agents/",
      ]

      // 获取相对路径或文件名
      const file = rel(item, patterns) ?? path.basename(item)

      // 移除扩展名得到 Agent 名称
      const agentName = trim(file)

      // 构造 Agent 配置
      const config = {
        name: agentName, // Agent 名称
        ...md.data, // frontmatter 中的配置
        prompt: md.content.trim(), // Markdown 内容作为系统提示词
      }

      // 验证 Agent 配置
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }

      // 验证失败，抛出错误
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }

    return result
  }

  /**
   * Mode 文件的 Glob 模式
   *
   * 匹配 mode/ 或 modes/ 目录下的所有 .md 文件。
   */
  const MODE_GLOB = new Bun.Glob("{mode,modes}/*.md")

  /**
   * 加载目录中的 Mode 定义
   *
   * 从 mode/ 或 modes/ 目录中加载 Markdown 格式的 Mode 定义。
   * Mode 会被转换为 Agent（mode: "primary"）。
   *
   * @param dir - 配置目录路径
   * @returns Promise，解析为 Agent 名称到配置的映射
   *
   * 处理流程：
   * 1. 扫描 mode 目录中的所有 .md 文件
   * 2. 解析每个文件的 frontmatter 和内容
   * 3. 提取 Mode 名称（文件名，不含扩展名）
   * 4. 设置 mode: "primary"
   * 5. 验证配置
   * 6. 返回 Agent 映射
   */
  async function loadMode(dir: string) {
    // 存储 Agent 映射（Mode 转换为 Agent）
    const result: Record<string, Agent> = {}

    // 扫描 mode 目录中的所有 .md 文件
    for await (const item of MODE_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      // 解析 Markdown 文件
      const md = await ConfigMarkdown.parse(item)
      if (!md.data) continue

      // 构造 Mode 配置
      const config = {
        // 使用文件名（不含 .md 扩展名）作为名称
        name: path.basename(item, ".md"),
        ...md.data, // frontmatter 中的配置
        prompt: md.content.trim(), // Markdown 内容作为系统提示词
      }

      // 验证 Mode 配置
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        // 转换为 Agent 并设置 mode: "primary"
        result[config.name] = {
          ...parsed.data,
          mode: "primary" as const, // 标记为主 agent
        }
        continue
      }
    }

    return result
  }

  /**
   * 插件文件的 Glob 模式
   *
   * 匹配 plugin/ 或 plugins/ 目录下的所有 .ts 和 .js 文件。
   */
  const PLUGIN_GLOB = new Bun.Glob("{plugin,plugins}/*.{ts,js}")

  /**
   * 加载目录中的插件定义
   *
   * 从 plugin/ 或 plugins/ 目录中发现所有插件文件。
   *
   * @param dir - 配置目录路径
   * @returns Promise，解析为插件 URL 数组
   *
   * 处理流程：
   * 1. 扫描 plugin 目录中的所有 .ts 和 .js 文件
   * 2. 将文件路径转换为 file:// URL
   * 3. 返回 URL 数组
   *
   * 注意：只返回 URL，实际加载在后续进行。
   */
  async function loadPlugin(dir: string) {
    // 存储插件 URL 数组
    const plugins: string[] = []

    // 扫描 plugin 目录中的所有插件文件
    for await (const item of PLUGIN_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      // 将文件路径转换为 file:// URL
      plugins.push(pathToFileURL(item).href)
    }

    return plugins
  }

  /**
   * 从插件说明符中提取规范化的插件名称
   *
   * 用于插件去重，提取不包含版本信息的规范名称。
   *
   * @param plugin - 插件说明符（URL 或包名）
   * @returns 规范化的插件名称
   *
   * 处理规则：
   * - file:// URL：提取文件名（不含扩展名）
   * - npm 包：提取包名（不含版本号）
   * - 带作用域的包：保留作用域（@scope/pkg）
   *
   * @example
   * ```typescript
   * getPluginName("file:///path/to/plugin/foo.js")  // "foo"
   * getPluginName("oh-my-opencode@2.4.3")          // "oh-my-opencode"
   * getPluginName("@scope/pkg@1.0.0")              // "@scope/pkg"
   * ```
   */
  export function getPluginName(plugin: string): string {
    // 处理 file:// URL
    if (plugin.startsWith("file://")) {
      // 解析 URL 并提取文件名（不含扩展名）
      return path.parse(new URL(plugin).pathname).name
    }

    // 处理 npm 包
    // 查找最后一个 @ 符号（用于分隔版本号）
    const lastAt = plugin.lastIndexOf("@")
    if (lastAt > 0) {
      // @ 符号不在开头，说明是版本号分隔符
      return plugin.substring(0, lastAt)
    }

    // 没有版本号，直接返回
    return plugin
  }

  /**
   * 去重插件列表
   *
   * 移除重复的插件，高优先级的插件（列表中靠后的）会覆盖低优先级的。
   *
   * 优先级顺序（从高到低）：
   * 1. 本地 plugin/ 目录
   * 2. 本地 opencode.json
   * 3. 全局 plugin/ 目录
   * 4. 全局 opencode.json
   *
   * 由于插件是按从低到高的优先级添加的，我们需要：
   * 1. 反转数组
   * 2. 去重（保留第一次出现的，即高优先级的）
   * 3. 再次反转恢复顺序
   *
   * @param plugins - 插件说明符数组
   * @returns 去重后的插件数组
   *
   * @example
   * ```typescript
   * const plugins = [
   *   "oh-my-opencode@1.0.0",  // 全局，低优先级
   *   "oh-my-opencode@2.0.0",  // 本地，高优先级
   *   "file:///path/plugin.js" // 本地文件
   * ]
   * const deduplicated = deduplicatePlugins(plugins)
   * // ["oh-my-opencode@2.0.0", "file:///path/plugin.js"]
   * ```
   */
  export function deduplicatePlugins(plugins: string[]): string[] {
    // 存储已见过的规范插件名称
    // 例如："oh-my-opencode", "@scope/pkg"
    const seenNames = new Set<string>()

    // 存储唯一插件说明符（要返回的）
    // 例如："oh-my-opencode@2.4.3", "file:///path/to/plugin.js"
    const uniqueSpecifiers: string[] = []

    // 反转数组，从高优先级开始处理
    for (const specifier of plugins.toReversed()) {
      // 提取规范名称
      const name = getPluginName(specifier)

      // 如果名称未见过，添加到结果
      if (!seenNames.has(name)) {
        seenNames.add(name)
        uniqueSpecifiers.push(specifier)
      }
      // 如果名称已见过，跳过（保留高优先级的）
    }

    // 再次反转，恢复原始顺序（低到高）
    return uniqueSpecifiers.toReversed()
  }

  // ============================================================================
  // Schema 定义
  // ============================================================================

  /**
   * 本地 MCP 服务器配置 Schema
   *
   * 定义通过命令行启动的本地 MCP 服务器配置。
   */
  export const McpLocal = z
    .object({
      // 类型标识：本地
      type: z.literal("local").describe("Type of MCP server connection"),
      // 启动 MCP 服务器的命令和参数数组
      command: z.string().array().describe("Command and arguments to run the MCP server"),
      // 运行 MCP 服务器时设置的环境变量
      environment: z
        .record(z.string(), z.string())
        .optional()
        .describe("Environment variables to set when running the MCP server"),
      // 启动时是否启用 MCP 服务器
      enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
      // 从 MCP 服务器获取工具的超时时间（毫秒）
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Timeout in ms for fetching tools from the MCP server. Defaults to 5000 (5 seconds) if not specified.",
        ),
    })
    .strict() // 不允许额外字段
    .meta({
      ref: "McpLocalConfig",
    })

  /**
   * MCP OAuth 认证配置 Schema
   *
   * 定义 MCP 服务器的 OAuth 认证配置。
   */
  export const McpOAuth = z
    .object({
      // OAuth 客户端 ID（可选）
      // 如果不提供，将尝试动态客户端注册（RFC 7591）
      clientId: z
        .string()
        .optional()
        .describe("OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted."),
      // OAuth 客户端密钥（可选）
      clientSecret: z.string().optional().describe("OAuth client secret (if required by the authorization server)"),
      // 请求授权时的 OAuth 范围
      scope: z.string().optional().describe("OAuth scopes to request during authorization"),
    })
    .strict() // 不允许额外字段
    .meta({
      ref: "McpOAuthConfig",
    })

  /**
   * MCP OAuth 配置类型
   */
  export type McpOAuth = z.infer<typeof McpOAuth>

  /**
   * 远程 MCP 服务器配置 Schema
   *
   * 定义通过网络访问的远程 MCP 服务器配置。
   */
  export const McpRemote = z
    .object({
      // 类型标识：远程
      type: z.literal("remote").describe("Type of MCP server connection"),
      // MCP 服务器的 URL
      url: z.string().describe("URL of the remote MCP server"),
      // 启动时是否启用 MCP 服务器
      enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
      // 发送请求时附加的 HTTP 头
      headers: z.record(z.string(), z.string()).optional().describe("Headers to send with the request"),
      // OAuth 认证配置
      oauth: z
        .union([McpOAuth, z.literal(false)]) // 可以是 OAuth 配置或 false（禁用自动检测）
        .optional()
        .describe(
          "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
        ),
      // 从 MCP 服务器获取工具的超时时间（毫秒）
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Timeout in ms for fetching tools from the MCP server. Defaults to 5000 (5 seconds) if not specified.",
        ),
    })
    .strict() // 不允许额外字段
    .meta({
      ref: "McpRemoteConfig",
    })

  /**
   * MCP 服务器配置联合类型
   *
   * 使用 discriminatedUnion 根据 type 字段区分不同配置。
   */
  export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])

  /**
   * MCP 配置类型
   */
  export type Mcp = z.infer<typeof Mcp>

  /**
   * 权限动作枚举
   *
   * 定义三种权限动作：
   * - "ask"：询问用户
   * - "allow"：自动允许
   * - "deny"：自动拒绝
   */
  export const PermissionAction = z.enum(["ask", "allow", "deny"]).meta({
    ref: "PermissionActionConfig",
  })

  /**
   * 权限动作类型
   */
  export type PermissionAction = z.infer<typeof PermissionAction>

  /**
   * 权限对象 Schema
   *
   * 定义权限名称到动作的映射。
   */
  export const PermissionObject = z.record(z.string(), PermissionAction).meta({
    ref: "PermissionObjectConfig",
  })

  /**
   * 权限对象类型
   */
  export type PermissionObject = z.infer<typeof PermissionObject>

  /**
   * 权限规则联合类型
   *
   * 可以是单个动作或权限对象。
   */
  export const PermissionRule = z.union([PermissionAction, PermissionObject]).meta({
    ref: "PermissionRuleConfig",
  })

  /**
   * 权限规则类型
   */
  export type PermissionRule = z.infer<typeof PermissionRule>

  /**
   * 权限预处理器
   *
   * 在 Zod 重新排序之前捕获原始键顺序，
   * 然后在转换中按原始顺序重建。
   * 这确保配置中的字段顺序保持不变。
   */
  const permissionPreprocess = (val: unknown) => {
    // 如果是对象（不是数组），保存原始键顺序
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      return { __originalKeys: Object.keys(val), ...val }
    }
    // 不是对象，直接返回
    return val
  }

  /**
   * 权限转换函数
   *
   * 将权限值转换为标准格式，保留原始键顺序。
   */
  const permissionTransform = (x: unknown): Record<string, PermissionRule> => {
    // 如果是字符串，转换为通配符规则
    if (typeof x === "string") return { "*": x as PermissionAction }

    // 提取原始键顺序
    const obj = x as { __originalKeys?: string[] } & Record<string, unknown>
    const { __originalKeys, ...rest } = obj

    // 如果没有原始键，直接返回
    if (!__originalKeys) return rest as Record<string, PermissionRule>

    // 按原始顺序重建对象
    const result: Record<string, PermissionRule> = {}
    for (const key of __originalKeys) {
      if (key in rest) result[key] = rest[key] as PermissionRule
    }

    return result
  }

  /**
   * 权限配置 Schema
   *
   * 定义所有可配置的权限规则。
   * 支持简写形式（字符串）或详细形式（对象）。
   */
  export const Permission = z
    .preprocess(
      // 预处理：保存原始键顺序
      permissionPreprocess,
      // 验证：定义所有权限字段
      z
        .object({
          // 内部字段：原始键顺序（可选）
          __originalKeys: z.string().array().optional(),
          // 读取文件权限
          read: PermissionRule.optional(),
          // 编辑文件权限
          edit: PermissionRule.optional(),
          // Glob 搜索权限
          glob: PermissionRule.optional(),
          // Grep 搜索权限
          grep: PermissionRule.optional(),
          // 列出文件权限
          list: PermissionRule.optional(),
          // 执行 Bash 命令权限
          bash: PermissionRule.optional(),
          // 启动子任务权限
          task: PermissionRule.optional(),
          // 访问外部目录权限
          external_directory: PermissionRule.optional(),
          // 写入 Todo 权限
          todowrite: PermissionAction.optional(),
          // 读取 Todo 权限
          todoread: PermissionAction.optional(),
          // 提问权限
          question: PermissionAction.optional(),
          // Web 获取权限
          webfetch: PermissionAction.optional(),
          // Web 搜索权限
          websearch: PermissionAction.optional(),
          // 代码搜索权限
          codesearch: PermissionAction.optional(),
          // LSP 权限
          lsp: PermissionRule.optional(),
          // 防止死循环权限
          doom_loop: PermissionAction.optional(),
        })
        .catchall(PermissionRule) // 允许额外字段
        .or(PermissionAction), // 或单个动作
    )
    .transform(permissionTransform) // 转换：保留原始键顺序
    .meta({
      ref: "PermissionConfig",
    })

  /**
   * 权限配置类型
   */
  export type Permission = z.infer<typeof Permission>

  /**
   * 命令配置 Schema
   *
   * 定义用户自定义命令的配置。
   */
  export const Command = z.object({
    // 命令模板（可以是字符串或字符串数组）
    template: z.string(),
    // 命令描述
    description: z.string().optional(),
    // 使用的 Agent
    agent: z.string().optional(),
    // 使用的模型
    model: z.string().optional(),
    // 是否作为子任务执行
    subtask: z.boolean().optional(),
  })

  /**
   * 命令配置类型
   */
  export type Command = z.infer<typeof Command>

  /**
   * Agent 配置 Schema
   *
   * 定义 AI Agent 的配置。
   * 包含模型选择、系统提示词、权限等。
   */
  export const Agent = z
    .object({
      // 使用的模型（格式：provider/model）
      model: z.string().optional(),
      // 采样温度
      temperature: z.number().optional(),
      // Top-p 采样参数
      top_p: z.number().optional(),
      // 系统提示词
      prompt: z.string().optional(),
      // 工具配置（已废弃，使用 permission）
      tools: z.record(z.string(), z.boolean()).optional().describe("@deprecated Use 'permission' field instead"),
      // 是否禁用此 Agent
      disable: z.boolean().optional(),
      // Agent 描述（用于选择何时使用）
      description: z.string().optional().describe("Description of when to use the agent"),
      // Agent 模式
      mode: z.enum(["subagent", "primary", "all"]).optional(),
      // 是否在 @ 自动完成菜单中隐藏
      hidden: z
        .boolean()
        .optional()
        .describe("Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)"),
      // 额外选项（任意键值对）
      options: z.record(z.string(), z.any()).optional(),
      // Agent 颜色（十六进制）
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format")
        .optional()
        .describe("Hex color code for the agent (e.g., #FF5733)"),
      // 最大 agentic 迭代次数
      steps: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of agentic iterations before forcing text-only response"),
      // 最大步数（已废弃，使用 steps）
      maxSteps: z.number().int().positive().optional().describe("@deprecated Use 'steps' field instead."),
      // 权限配置
      permission: Permission.optional(),
    })
    .catchall(z.any()) // 允许额外字段
    .transform((agent, ctx) => {
      // 已知字段集合
      const knownKeys = new Set([
        "name",
        "model",
        "prompt",
        "description",
        "temperature",
        "top_p",
        "mode",
        "hidden",
        "color",
        "steps",
        "maxSteps",
        "options",
        "permission",
        "disable",
        "tools",
      ])

      // 提取未知属性到 options
      const options: Record<string, unknown> = { ...agent.options }
      for (const [key, value] of Object.entries(agent)) {
        if (!knownKeys.has(key)) options[key] = value
      }

      // 将旧的 tools 配置转换为 permissions
      const permission: Permission = {}
      for (const [tool, enabled] of Object.entries(agent.tools ?? {})) {
        const action = enabled ? "allow" : "deny"
        // write, edit, patch, multiedit 都映射到 edit 权限
        if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
          permission.edit = action
        } else {
          permission[tool] = action
        }
      }
      Object.assign(permission, agent.permission)

      // 将旧的 maxSteps 转换为 steps
      const steps = agent.steps ?? agent.maxSteps

      // 返回转换后的配置
      return { ...agent, options, permission, steps } as typeof agent & {
        options?: Record<string, unknown>
        permission?: Permission
        steps?: number
      }
    })
    .meta({
      ref: "AgentConfig",
    })

  /**
   * Agent 配置类型
   */
  export type Agent = z.infer<typeof Agent>

  /**
   * 快捷键配置 Schema
   *
   * 定义所有可配置的快捷键。
   */
  export const Keybinds = z
    .object({
      // Leader 键（用于组合键）
      leader: z.string().optional().default("ctrl+x").describe("Leader key for keybind combinations"),
      // 退出应用
      app_exit: z.string().optional().default("ctrl+c,ctrl+d,<leader>q").describe("Exit the application"),
      // 打开外部编辑器
      editor_open: z.string().optional().default("<leader>e").describe("Open external editor"),
      // 列出可用主题
      theme_list: z.string().optional().default("<leader>t").describe("List available themes"),
      // 切换侧边栏
      sidebar_toggle: z.string().optional().default("<leader>b").describe("Toggle sidebar"),
      // 切换滚动条
      scrollbar_toggle: z.string().optional().default("none").describe("Toggle session scrollbar"),
      // 切换用户名显示
      username_toggle: z.string().optional().default("none").describe("Toggle username visibility"),
      // 查看状态
      status_view: z.string().optional().default("<leader>s").describe("View status"),
      // 导出会话
      session_export: z.string().optional().default("<leader>x").describe("Export session to editor"),
      // 新建会话
      session_new: z.string().optional().default("<leader>n").describe("Create a new session"),
      // 列出所有会话
      session_list: z.string().optional().default("<leader>l").describe("List all sessions"),
      // 显示会话时间线
      session_timeline: z.string().optional().default("<leader>g").describe("Show session timeline"),
      // 从消息分支会话
      session_fork: z.string().optional().default("none").describe("Fork session from message"),
      // 重命名会话
      session_rename: z.string().optional().default("none").describe("Rename session"),
      // 共享当前会话
      session_share: z.string().optional().default("none").describe("Share current session"),
      // 取消共享当前会话
      session_unshare: z.string().optional().default("none").describe("Unshare current session"),
      // 中断当前会话
      session_interrupt: z.string().optional().default("escape").describe("Interrupt current session"),
      // 压缩会话
      session_compact: z.string().optional().default("<leader>c").describe("Compact the session"),
      // 向上翻页
      messages_page_up: z.string().optional().default("pageup").describe("Scroll messages up by one page"),
      // 向下翻页
      messages_page_down: z.string().optional().default("pagedown").describe("Scroll messages down by one page"),
      // 向上翻半页
      messages_half_page_up: z.string().optional().default("ctrl+alt+u").describe("Scroll messages up by half page"),
      // 向下翻半页
      messages_half_page_down: z
        .string()
        .optional()
        .default("ctrl+alt+d")
        .describe("Scroll messages down by half page"),
      // 跳转到第一条消息
      messages_first: z.string().optional().default("ctrl+g,home").describe("Navigate to first message"),
      // 跳转到最后一条消息
      messages_last: z.string().optional().default("ctrl+alt+g,end").describe("Navigate to last message"),
      // 下一条消息
      messages_next: z.string().optional().default("none").describe("Navigate to next message"),
      // 上一条消息
      messages_previous: z.string().optional().default("none").describe("Navigate to previous message"),
      // 最后一条用户消息
      messages_last_user: z.string().optional().default("none").describe("Navigate to last user message"),
      // 复制消息
      messages_copy: z.string().optional().default("<leader>y").describe("Copy message"),
      // 撤销消息
      messages_undo: z.string().optional().default("<leader>u").describe("Undo message"),
      // 重做消息
      messages_redo: z.string().optional().default("<leader>r").describe("Redo message"),
      // 切换代码块隐藏
      messages_toggle_conceal: z
        .string()
        .optional()
        .default("<leader>h")
        .describe("Toggle code block concealment in messages"),
      // 切换工具详情
      tool_details: z.string().optional().default("none").describe("Toggle tool details visibility"),
      // 列出可用模型
      model_list: z.string().optional().default("<leader>m").describe("List available models"),
      // 切换最近使用的模型
      model_cycle_recent: z.string().optional().default("f2").describe("Next recently used model"),
      // 反向切换最近使用的模型
      model_cycle_recent_reverse: z.string().optional().default("shift+f2").describe("Previous recently used model"),
      // 切换收藏的模型
      model_cycle_favorite: z.string().optional().default("none").describe("Next favorite model"),
      // 反向切换收藏的模型
      model_cycle_favorite_reverse: z.string().optional().default("none").describe("Previous favorite model"),
      // 列出可用命令
      command_list: z.string().optional().default("ctrl+p").describe("List available commands"),
      // 列出 Agent
      agent_list: z.string().optional().default("<leader>a").describe("List agents"),
      // 下一个 Agent
      agent_cycle: z.string().optional().default("tab").describe("Next agent"),
      // 上一个 Agent
      agent_cycle_reverse: z.string().optional().default("shift+tab").describe("Previous agent"),
      // 切换模型变体
      variant_cycle: z.string().optional().default("ctrl+t").describe("Cycle model variants"),
      // 清空输入
      input_clear: z.string().optional().default("ctrl+c").describe("Clear input field"),
      // 粘贴
      input_paste: z.string().optional().default("ctrl+v").describe("Paste from clipboard"),
      // 提交输入
      input_submit: z.string().optional().default("return").describe("Submit input"),
      // 插入换行
      input_newline: z
        .string()
        .optional()
        .default("shift+return,ctrl+return,alt+return,ctrl+j")
        .describe("Insert newline in input"),
      // 光标左移
      input_move_left: z.string().optional().default("left,ctrl+b").describe("Move cursor left in input"),
      // 光标右移
      input_move_right: z.string().optional().default("right,ctrl+f").describe("Move cursor right in input"),
      // 光标上移
      input_move_up: z.string().optional().default("up").describe("Move cursor up in input"),
      // 光标下移
      input_move_down: z.string().optional().default("down").describe("Move cursor down in input"),
      // 向左选择
      input_select_left: z.string().optional().default("shift+left").describe("Select left in input"),
      // 向右选择
      input_select_right: z.string().optional().default("shift+right").describe("Select right in input"),
      // 向上选择
      input_select_up: z.string().optional().default("shift+up").describe("Select up in input"),
      // 向下选择
      input_select_down: z.string().optional().default("shift+down").describe("Select down in input"),
      // 跳转到行首
      input_line_home: z.string().optional().default("ctrl+a").describe("Move to start of line in input"),
      // 跳转到行尾
      input_line_end: z.string().optional().default("ctrl+e").describe("Move to end of line in input"),
      // 选择到行首
      input_select_line_home: z
        .string()
        .optional()
        .default("ctrl+shift+a")
        .describe("Select to start of line in input"),
      // 选择到行尾
      input_select_line_end: z.string().optional().default("ctrl+shift+e").describe("Select to end of line in input"),
      // 跳转到可视行首
      input_visual_line_home: z.string().optional().default("alt+a").describe("Move to start of visual line in input"),
      // 跳转到可视行尾
      input_visual_line_end: z.string().optional().default("alt+e").describe("Move to end of visual line in input"),
      // 选择到可视行首
      input_select_visual_line_home: z
        .string()
        .optional()
        .default("alt+shift+a")
        .describe("Select to start of visual line in input"),
      // 选择到可视行尾
      input_select_visual_line_end: z
        .string()
        .optional()
        .default("alt+shift+e")
        .describe("Select to end of visual line in input"),
      // 跳转到缓冲区首
      input_buffer_home: z.string().optional().default("home").describe("Move to start of buffer in input"),
      // 跳转到缓冲区尾
      input_buffer_end: z.string().optional().default("end").describe("Move to end of buffer in input"),
      // 选择到缓冲区首
      input_select_buffer_home: z
        .string()
        .optional()
        .default("shift+home")
        .describe("Select to start of buffer in input"),
      // 选择到缓冲区尾
      input_select_buffer_end: z.string().optional().default("shift+end").describe("Select to end of buffer in input"),
      // 删除行
      input_delete_line: z.string().optional().default("ctrl+shift+d").describe("Delete line in input"),
      // 删除到行尾
      input_delete_to_line_end: z.string().optional().default("ctrl+k").describe("Delete to end of line in input"),
      // 删除到行首
      input_delete_to_line_start: z.string().optional().default("ctrl+u").describe("Delete to start of line in input"),
      // 退格
      input_backspace: z.string().optional().default("backspace,shift+backspace").describe("Backspace in input"),
      // 删除字符
      input_delete: z.string().optional().default("ctrl+d,delete,shift+delete").describe("Delete character in input"),
      // 撤销
      input_undo: z.string().optional().default("ctrl+-,super+z").describe("Undo in input"),
      // 重做
      input_redo: z.string().optional().default("ctrl+.,super+shift+z").describe("Redo in input"),
      // 前移一个词
      input_word_forward: z
        .string()
        .optional()
        .default("alt+f,alt+right,ctrl+right")
        .describe("Move word forward in input"),
      // 后移一个词
      input_word_backward: z
        .string()
        .optional()
        .default("alt+b,alt+left,ctrl+left")
        .describe("Move word backward in input"),
      // 选择前一个词
      input_select_word_forward: z
        .string()
        .optional()
        .default("alt+shift+f,alt+shift+right")
        .describe("Select word forward in input"),
      // 选择后一个词
      input_select_word_backward: z
        .string()
        .optional()
        .default("alt+shift+b,alt+shift+left")
        .describe("Select word backward in input"),
      // 删除前一个词
      input_delete_word_forward: z
        .string()
        .optional()
        .default("alt+d,alt+delete,ctrl+delete")
        .describe("Delete word forward in input"),
      // 删除后一个词
      input_delete_word_backward: z
        .string()
        .optional()
        .default("ctrl+w,ctrl+backspace,alt+backspace")
        .describe("Delete word backward in input"),
      // 上一条历史
      history_previous: z.string().optional().default("up").describe("Previous history item"),
      // 下一条历史
      history_next: z.string().optional().default("down").describe("Next history item"),
      // 下一个子会话
      session_child_cycle: z.string().optional().default("<leader>right").describe("Next child session"),
      // 上一个子会话
      session_child_cycle_reverse: z.string().optional().default("<leader>left").describe("Previous child session"),
      // 跳转到父会话
      session_parent: z.string().optional().default("<leader>up").describe("Go to parent session"),
      // 挂起终端
      terminal_suspend: z.string().optional().default("ctrl+z").describe("Suspend terminal"),
      // 切换终端标题
      terminal_title_toggle: z.string().optional().default("none").describe("Toggle terminal title"),
      // 切换提示
      tips_toggle: z.string().optional().default("<leader>h").describe("Toggle tips on home screen"),
    })
    .strict() // 不允许额外字段
    .meta({
      ref: "KeybindsConfig",
    })

  /**
   * TUI 配置 Schema
   *
   * 定义终端用户界面的配置选项。
   */
  export const TUI = z.object({
    // 滚动速度
    scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
    // 滚动加速设置
    scroll_acceleration: z
      .object({
        // 是否启用滚动加速
        enabled: z.boolean().describe("Enable scroll acceleration"),
      })
      .optional()
      .describe("Scroll acceleration settings"),
    // 差异渲染样式
    diff_style: z
      .enum(["auto", "stacked"])
      .optional()
      .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  })

  /**
   * 服务器配置 Schema
   *
   * 定义 OpenCode 服务器的配置选项。
   */
  export const Server = z
    .object({
      // 监听端口
      port: z.number().int().positive().optional().describe("Port to listen on"),
      // 监听主机名
      hostname: z.string().optional().describe("Hostname to listen on"),
      // 是否启用 mDNS 服务发现
      mdns: z.boolean().optional().describe("Enable mDNS service discovery"),
      // 额外允许的 CORS 域
      cors: z.array(z.string()).optional().describe("Additional domains to allow for CORS"),
    })
    .strict() // 不允许额外字段
    .meta({
      ref: "ServerConfig",
    })

  /**
   * 布局配置枚举
   *
   * 已废弃：始终使用 stretch 布局。
   */
  export const Layout = z.enum(["auto", "stretch"]).meta({
    ref: "LayoutConfig",
  })

  /**
   * 布局配置类型
   */
  export type Layout = z.infer<typeof Layout>

  /**
   * 提供商配置 Schema
   *
   * 定义 AI 提供商的配置选项。
   */
  export const Provider = ModelsDev.Provider.partial()
    .extend({
      // 白名单模型列表
      whitelist: z.array(z.string()).optional(),
      // 黑名单模型列表
      blacklist: z.array(z.string()).optional(),
      // 模型配置覆盖
      models: z
        .record(
          z.string(),
          ModelsDev.Model.partial().extend({
            // 变体配置
            variants: z
              .record(
                z.string(),
                z
                  .object({
                    // 是否禁用此变体
                    disabled: z.boolean().optional().describe("Disable this variant for the model"),
                  })
                  .catchall(z.any()),
              )
              .optional()
              .describe("Variant-specific configuration"),
          }),
        )
        .optional(),
      // 提供商选项
      options: z
        .object({
          // API 密钥
          apiKey: z.string().optional(),
          // 基础 URL
          baseURL: z.string().optional(),
          // 企业版 URL（GitHub Copilot）
          enterpriseUrl: z.string().optional().describe("GitHub Enterprise URL for copilot authentication"),
          // 启用提示缓存键
          setCacheKey: z.boolean().optional().describe("Enable promptCacheKey for this provider (default false)"),
          // 请求超时设置
          timeout: z
            .union([
              z
                .number()
                .int()
                .positive()
                .describe(
                  "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
                ),
              z.literal(false).describe("Disable timeout for this provider entirely."),
            ])
            .optional()
            .describe(
              "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
            ),
        })
        .catchall(z.any())
        .optional(),
    })
    .strict() // 不允许额外字段
    .meta({
      ref: "ProviderConfig",
    })

  /**
   * 提供商配置类型
   */
  export type Provider = z.infer<typeof Provider>

  /**
   * 配置信息 Schema
   *
   * 定义完整的 OpenCode 配置结构。
   */
  export const Info = z
    .object({
      // JSON Schema 引用
      $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
      // 主题名称
      theme: z.string().optional().describe("Theme name to use for the interface"),
      // 快捷键配置
      keybinds: Keybinds.optional().describe("Custom keybind configurations"),
      // 日志级别
      logLevel: Log.Level.optional().describe("Log level"),
      // TUI 配置
      tui: TUI.optional().describe("TUI specific settings"),
      // 服务器配置
      server: Server.optional().describe("Server configuration for opencode serve and web commands"),
      // 命令配置
      command: z
        .record(z.string(), Command)
        .optional()
        .describe("Command configuration, see https://opencode.ai/docs/commands"),
      // 文件监视器配置
      watcher: z
        .object({
          // 忽略的文件模式
          ignore: z.array(z.string()).optional(),
        })
        .optional(),
      // 插件列表
      plugin: z.string().array().optional(),
      // 是否启用快照
      snapshot: z.boolean().optional(),
      // 共享行为
      share: z
        .enum(["manual", "auto", "disabled"])
        .optional()
        .describe(
          "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
        ),
      // 自动共享（已废弃）
      autoshare: z
        .boolean()
        .optional()
        .describe("@deprecated Use 'share' field instead. Share newly created sessions automatically"),
      // 自动更新
      autoupdate: z
        .union([z.boolean(), z.literal("notify")])
        .optional()
        .describe(
          "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
        ),
      // 禁用的提供商列表
      disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
      // 启用的提供商列表（仅启用这些）
      enabled_providers: z
        .array(z.string())
        .optional()
        .describe("When set, ONLY these providers will be enabled. All other providers will be ignored"),
      // 默认模型（格式：provider/model）
      model: z.string().describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
      // 小模型（用于标题生成等）
      small_model: z
        .string()
        .describe("Small model to use for tasks like title generation in the format of provider/model")
        .optional(),
      // 默认 Agent
      default_agent: z
        .string()
        .optional()
        .describe(
          "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
        ),
      // 用户名
      username: z
        .string()
        .optional()
        .describe("Custom username to display in conversations instead of system username"),
      // 模式配置（已废弃）
      mode: z
        .object({
          build: Agent.optional(),
          plan: Agent.optional(),
        })
        .catchall(Agent)
        .optional()
        .describe("@deprecated Use `agent` field instead."),
      // Agent 配置
      agent: z
        .object({
          // 主要 Agent
          plan: Agent.optional(),
          build: Agent.optional(),
          // 子 Agent
          general: Agent.optional(),
          explore: Agent.optional(),
          // 专用 Agent
          title: Agent.optional(),
          summary: Agent.optional(),
          compaction: Agent.optional(),
        })
        .catchall(Agent)
        .optional()
        .describe("Agent configuration, see https://opencode.ai/docs/agent"),
      // 提供商配置
      provider: z
        .record(z.string(), Provider)
        .optional()
        .describe("Custom provider configurations and model overrides"),
      // MCP 服务器配置
      mcp: z
        .record(
          z.string(),
          z.union([
            Mcp,
            z
              .object({
                enabled: z.boolean(),
              })
              .strict(),
          ]),
        )
        .optional()
        .describe("MCP (Model Context Protocol) server configurations"),
      // 格式化器配置
      formatter: z
        .union([
          z.literal(false), // 禁用
          z.record(
            z.string(),
            z.object({
              disabled: z.boolean().optional(),
              command: z.array(z.string()).optional(),
              environment: z.record(z.string(), z.string()).optional(),
              extensions: z.array(z.string()).optional(),
            }),
          ),
        ])
        .optional(),
      // LSP 配置
      lsp: z
        .union([
          z.literal(false), // 禁用
          z.record(
            z.string(),
            z.union([
              z.object({
                disabled: z.literal(true),
              }),
              z.object({
                command: z.array(z.string()),
                extensions: z.array(z.string()).optional(),
                disabled: z.boolean().optional(),
                env: z.record(z.string(), z.string()).optional(),
                initialization: z.record(z.string(), z.any()).optional(),
              }),
            ]),
          ),
        ])
        .optional()
        .refine(
          (data) => {
            if (!data) return true
            if (typeof data === "boolean") return true
            const serverIds = new Set(Object.values(LSPServer).map((s) => s.id))

            return Object.entries(data).every(([id, config]) => {
              if (config.disabled) return true
              if (serverIds.has(id)) return true
              return Boolean(config.extensions)
            })
          },
          {
            error: "For custom LSP servers, 'extensions' array is required.",
          },
        ),
      // 指令文件
      instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
      // 布局（已废弃）
      layout: Layout.optional().describe("@deprecated Always uses stretch layout."),
      // 权限配置
      permission: Permission.optional(),
      // 工具配置（已废弃）
      tools: z.record(z.string(), z.boolean()).optional(),
      // 企业版配置
      enterprise: z
        .object({
          url: z.string().optional().describe("Enterprise URL"),
        })
        .optional(),
      // 压缩配置
      compaction: z
        .object({
          auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
          prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
        })
        .optional(),
      // 实验性功能
      experimental: z
        .object({
          // Hook 配置
          hook: z
            .object({
              // 文件编辑 Hook
              file_edited: z
                .record(
                  z.string(),
                  z
                    .object({
                      command: z.string().array(),
                      environment: z.record(z.string(), z.string()).optional(),
                    })
                    .array(),
                )
                .optional(),
              // 会话完成 Hook
              session_completed: z
                .object({
                  command: z.string().array(),
                  environment: z.record(z.string(), z.string()).optional(),
                })
                .array()
                .optional(),
            })
            .optional(),
          // 聊天最大重试次数
          chatMaxRetries: z.number().optional().describe("Number of retries for chat completions on failure"),
          // 禁用粘贴摘要
          disable_paste_summary: z.boolean().optional(),
          // 启用批处理工具
          batch_tool: z.boolean().optional().describe("Enable the batch tool"),
          // OpenTelemetry
          openTelemetry: z
            .boolean()
            .optional()
            .describe("Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)"),
          // 主 Agent 专用工具
          primary_tools: z
            .array(z.string())
            .optional()
            .describe("Tools that should only be available to primary agents."),
          // 拒绝时继续循环
          continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
          // MCP 超时
          mcp_timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Timeout in milliseconds for model context protocol (MCP) requests"),
        })
        .optional(),
    })
    .strict() // 不允许额外字段
    .meta({
      ref: "Config",
    })

  /**
   * 配置信息类型
   *
   * 从 Info Schema 推断出的 TypeScript 类型。
   */
  export type Info = z.output<typeof Info>

  /**
   * 全局配置（惰性加载）
   *
   * 加载全局用户配置目录中的配置文件。
   * 按优先级合并：config.json < opencode.json < opencode.jsonc
   */
  export const global = lazy(async () => {
    // 使用 pipe 逐步合并配置
    let result: Info = pipe(
      {}, // 从空对象开始
      mergeDeep(await loadFile(path.join(Global.Path.config, "config.json"))), // 合并 config.json
      mergeDeep(await loadFile(path.join(Global.Path.config, "opencode.json"))), // 合并 opencode.json
      mergeDeep(await loadFile(path.join(Global.Path.config, "opencode.jsonc"))), // 合并 opencode.jsonc
    )

    // 尝试迁移旧的 TOML 配置文件
    await import(path.join(Global.Path.config, "config"), {
      with: {
        type: "toml",
      },
    })
      .then(async (mod) => {
        // 提取 provider 和 model，构造模型字符串
        const { provider, model, ...rest } = mod.default
        if (provider && model) result.model = `${provider}/${model}`

        // 添加 schema
        result["$schema"] = "https://opencode.ai/config.json"

        // 合并其余配置
        result = mergeDeep(result, rest)

        // 写入新的 JSON 配置文件
        await Bun.write(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))

        // 删除旧的 TOML 配置文件
        await fs.unlink(path.join(Global.Path.config, "config"))
      })
      .catch(() => {}) // 忽略错误

    // 返回合并后的配置
    return result
  })

  /**
   * 加载配置文件
   *
   * 从指定路径加载配置文件。
   *
   * @param filepath - 配置文件路径
   * @returns Promise，解析为配置对象
   *
   * 处理流程：
   * 1. 读取文件内容
   * 2. 如果文件不存在，返回空对象
   * 3. 调用 load() 解析内容
   */
  async function loadFile(filepath: string): Promise<Info> {
    // 记录正在加载的文件
    log.info("loading", { path: filepath })

    // 读取文件内容
    let text = await Bun.file(filepath)
      .text()
      .catch((err) => {
        // ENOENT：文件不存在，忽略
        if (err.code === "ENOENT") return
        // 其他错误，抛出 JSON 错误
        throw new JsonError({ path: filepath }, { cause: err })
      })

    // 如果没有内容，返回空对象
    if (!text) return {}

    // 解析配置内容
    return load(text, filepath)
  }

  /**
   * 解析配置内容
   *
   * 解析配置文本（支持 JSONC、变量替换、文件包含）。
   *
   * @param text - 配置文本内容
   * @param configFilepath - 配置文件路径（用于错误信息）
   * @returns Promise，解析为配置对象
   *
   * 处理流程：
   * 1. 替换环境变量占位符 {env:VAR_NAME}
   * 2. 包含文件内容 {file:path/to/file}
   * 3. 解析 JSONC
   * 4. 验证配置
   * 5. 自动添加 $schema（如果缺失）
   */
  async function load(text: string, configFilepath: string) {
    // 第一步：替换环境变量占位符
    // {env:VAR_NAME} -> process.env.VAR_NAME 或空字符串
    text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || ""
    })

    // 第二步：处理文件内容包含
    // {file:path/to/file} -> 文件内容
    const fileMatches = text.match(/\{file:[^}]+\}/g)
    if (fileMatches) {
      // 获取配置文件所在目录
      const configDir = path.dirname(configFilepath)
      // 按行分割文本
      const lines = text.split("\n")

      // 遍历所有文件匹配
      for (const match of fileMatches) {
        // 查找匹配所在的行号
        const lineIndex = lines.findIndex((line) => line.includes(match))
        if (lineIndex !== -1 && lines[lineIndex].trim().startsWith("//")) {
          continue // 如果行是注释，跳过
        }

        // 提取文件路径（去掉 {file: 前缀和 } 后缀）
        let filePath = match.replace(/^\{file:/, "").replace(/\}$/, "")

        // 处理 ~ 开头的路径（用户主目录）
        if (filePath.startsWith("~/")) {
          filePath = path.join(os.homedir(), filePath.slice(2))
        }

        // 解析为绝对路径
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)

        // 读取文件内容
        const fileContent = (
          await Bun.file(resolvedPath)
            .text()
            .catch((error) => {
              const errMsg = `bad file reference: "${match}"`
              // 文件不存在
              if (error.code === "ENOENT") {
                throw new InvalidError(
                  {
                    path: configFilepath,
                    message: errMsg + ` ${resolvedPath} does not exist`,
                  },
                  { cause: error },
                )
              }
              // 其他错误
              throw new InvalidError({ path: configFilepath, message: errMsg }, { cause: error })
            })
        ).trim()

        // 将文件内容插入配置
        // 去掉首尾引号（如果有）
        text = text.replace(match, JSON.stringify(fileContent).slice(1, -1))
      }
    }

    // 第三步：解析 JSONC
    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })

    // 检查解析错误
    if (errors.length) {
      // 按行分割，用于显示错误上下文
      const lines = text.split("\n")

      // 格式化错误详情
      const errorDetails = errors
        .map((e) => {
          // 计算错误位置的行号和列号
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          // 格式化错误消息
          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          // 添加上下文行和指向符
          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      // 抛出 JSON 错误
      throw new JsonError({
        path: configFilepath,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    // 第四步：验证配置
    const parsed = Info.safeParse(data)
    if (parsed.success) {
      // 如果没有 $schema，自动添加
      if (!parsed.data.$schema) {
        parsed.data.$schema = "https://opencode.ai/config.json"
        // 尝试写回文件
        await Bun.write(configFilepath, JSON.stringify(parsed.data, null, 2)).catch(() => {})
      }

      // 获取验证后的数据
      const data = parsed.data

      // 解析插件路径（将相对路径解析为绝对路径）
      if (data.plugin) {
        for (let i = 0; i < data.plugin.length; i++) {
          const plugin = data.plugin[i]
          try {
            // 解析插件路径（相对于配置文件）
            data.plugin[i] = import.meta.resolve!(plugin, configFilepath)
          } catch (err) {
            // 解析失败，保持原样
          }
        }
      }

      return data
    }

    // 验证失败，抛出错误
    throw new InvalidError({
      path: configFilepath,
      issues: parsed.error.issues,
    })
  }

  /**
   * JSON 解析错误
   *
   * 当配置文件无法解析为 JSON 时抛出。
   */
  export const JsonError = NamedError.create(
    "ConfigJsonError",
    z.object({
      // 文件路径
      path: z.string(),
      // 错误消息
      message: z.string().optional(),
    }),
  )

  /**
   * 配置目录拼写错误
   *
   * 当配置目录名称可能拼写错误时抛出。
   */
  export const ConfigDirectoryTypoError = NamedError.create(
    "ConfigDirectoryTypoError",
    z.object({
      // 文件路径
      path: z.string(),
      // 目录名
      dir: z.string(),
      // 建议的正确名称
      suggestion: z.string(),
    }),
  )

  /**
   * 无效配置错误
   *
   * 当配置验证失败时抛出。
   */
  export const InvalidError = NamedError.create(
    "ConfigInvalidError",
    z.object({
      // 文件路径
      path: z.string(),
      // Zod 验证问题列表
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
      // 错误消息
      message: z.string().optional(),
    }),
  )

  /**
   * 获取当前配置
   *
   * @returns Promise，解析为当前配置对象
   *
   * @example
   * ```typescript
   * const config = await Config.get()
   * console.log(config.model)
   * ```
   */
  export async function get() {
    // 从配置状态获取配置
    return state().then((x) => x.config)
  }

  /**
   * 更新配置
   *
   * 将配置更改写入实例目录的 config.json。
   *
   * @param config - 要更新的配置对象
   * @returns Promise，完成时配置已更新
   *
   * 处理流程：
   * 1. 读取现有配置
   * 2. 合并新配置
   * 3. 写入文件
   * 4. 释放实例（触发重新加载）
   *
   * @example
   * ```typescript
   * await Config.update({ model: "openai/gpt-4" })
   * ```
   */
  export async function update(config: Info) {
    // 构造配置文件路径（实例目录）
    const filepath = path.join(Instance.directory, "config.json")

    // 读取现有配置
    const existing = await loadFile(filepath)

    // 合并配置并写入文件
    await Bun.write(filepath, JSON.stringify(mergeDeep(existing, config), null, 2))

    // 释放实例，触发重新加载
    await Instance.dispose()
  }

  /**
   * 获取配置目录列表
   *
   * @returns Promise，解析为配置目录路径数组
   *
   * @example
   * ```typescript
   * const dirs = await Config.directories()
   * console.log("配置目录:", dirs)
   * ```
   */
  export async function directories() {
    // 从配置状态获取目录列表
    return state().then((x) => x.directories)
  }
}
