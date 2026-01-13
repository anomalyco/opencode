/**
 * ============================================================================
 * 文件名：project.ts
 * 所属包：packages/opencode/src/project
 * ============================================================================
 *
 * 文件作用：
 * 项目管理模块。提供基于 Git 根提交哈希的项目识别和管理功能。
 *
 * 主要功能：
 * - fromDirectory()：从目录路径识别或创建项目
 * - discover()：发现项目图标（favicon）
 * - update()：更新项目信息（名称、图标等）
 * - sandboxes()：获取有效的沙盒目录列表
 * - setInitialized()：设置项目初始化时间
 * - list()：列出所有项目
 * - migrateFromGlobal()：从全局项目迁移会话数据
 *
 * 依赖关系：
 * - zod：类型验证和 Schema 定义
 * - fs/promises：异步文件操作
 * - path：路径处理
 * - bun：Bun 运行时（文件、Shell、Glob）
 * - ../util/filesystem：文件系统工具
 * - ../storage/storage：持久化存储
 * - ../util/log：日志记录
 * - ../flag/flag：命令行标志
 * - ../session：会话模块
 * - ../util/queue：工作队列
 * - @opencode-ai/util/fn：函数工具
 * - ../bus/bus-event：事件定义
 * - ../util/iife：IIFE 工具
 * - ../bus/global：全局事件总线
 *
 * 导出内容：
 * - Project namespace：项目管理命名空间
 *   - Info Schema：项目信息类型定义
 *   - Event.Updated：项目更新事件
 *   - fromDirectory(directory)：识别或创建项目
 *   - discover(input)：发现项目图标
 *   - update(input)：更新项目信息
 *   - sandboxes(projectID)：获取有效沙盒列表
 *   - setInitialized(projectID)：设置初始化时间
 *   - list()：列出所有项目
 *
 * 项目识别机制：
 * - 使用 Git 根提交哈希作为项目唯一标识符
 * - 缓存 ID 到 .git/opencode 文件以加速后续识别
 * - 支持工作树（worktree）和沙盒（sandbox）分离
 * - 全局项目使用 "global" 作为 ID
 *
 * 数据迁移：
 * - 从全局项目迁移会话到具体项目
 * - 自动处理会话的 projectID 更新
 *
 * 使用场景：
 * - 项目自动识别
 * - 跨工作目录的会话关联
 * - 项目元数据管理
 *
 * 使用示例：
 * ```typescript
 * // 从目录识别项目
 * const { project, sandbox } = await Project.fromDirectory("/path/to/repo")
 *
 * // 列出所有项目
 * const projects = await Project.list()
 *
 * // 更新项目名称
 * await Project.update({
 *   projectID: "abc123",
 *   name: "我的项目"
 * })
 *
 * // 获取有效沙盒
 * const validSandboxes = await Project.sandboxes("abc123")
 * ```
 *
 * @package opencode
 * @module project
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入异步文件操作模块
import fs from "fs/promises"

// 导入文件系统工具（向上查找等）
import { Filesystem } from "../util/filesystem"

// 导入路径处理模块
import path from "path"

// 导入 Bun 的 Shell 命令执行器
import { $ } from "bun"

// 导入持久化存储模块
import { Storage } from "../storage/storage"

// 导入日志模块
import { Log } from "../util/log"

// 导入标志解析模块
import { Flag } from "@/flag/flag"

// 导入会话模块
import { Session } from "../session"

// 导入工作队列函数
import { work } from "../util/queue"

// 导入函数工具（fn 包装器）
import { fn } from "@opencode-ai/util/fn"

// 导入事件定义工具
import { BusEvent } from "@/bus/bus-event"

// 导入 IIFE 工具
import { iife } from "@/util/iife"

// 导入全局事件总线
import { GlobalBus } from "@/bus/global"

// 导入文件存在性检查函数
import { existsSync } from "fs"

/**
 * 项目管理命名空间
 *
 * 提供项目识别、管理和元数据功能。
 */
export namespace Project {
  // 创建日志记录器
  const log = Log.create({ service: "project" })

  /**
   * 项目信息 Schema
   *
   * 定义项目信息的结构和类型。
   *
   * 字段说明：
   * - id：项目唯一标识符（Git 根提交哈希或 "global"）
   * - worktree：工作树根目录路径
   * - vcs：版本控制系统类型（可选，目前只支持 "git"）
   * - name：项目名称（可选）
   * - icon：项目图标（可选）
   *   - url：图标的 Data URL（base64 编码）
   *   - color：图标颜色（十六进制）
   * - time：时间戳信息
   *   - created：项目创建时间戳
   *   - updated：项目更新时间戳
   *   - initialized：项目初始化时间戳（可选）
   * - sandboxes：沙盒目录路径数组
   */
  export const Info = z
    .object({
      // 项目唯一标识符（Git 根提交哈希或 "global"）
      id: z.string(),
      // 工作树根目录路径
      worktree: z.string(),
      // 版本控制系统类型（可选，目前只支持 "git"）
      vcs: z.literal("git").optional(),
      // 项目名称（可选）
      name: z.string().optional(),
      // 项目图标（可选）
      icon: z
        .object({
          // 图标的 Data URL（base64 编码的图片）
          url: z.string().optional(),
          // 图标颜色（十六进制）
          color: z.string().optional(),
        })
        .optional(),
      // 时间戳信息
      time: z.object({
        // 项目创建时间戳（毫秒）
        created: z.number(),
        // 项目更新时间戳（毫秒）
        updated: z.number(),
        // 项目初始化时间戳（可选）
        initialized: z.number().optional(),
      }),
      // 沙盒目录路径数组
      sandboxes: z.array(z.string()),
    })
    .meta({
      // 元数据引用名称
      ref: "Project",
    })

  /**
   * 项目信息类型
   *
   * 从 Info Schema 推断出的 TypeScript 类型。
   */
  export type Info = z.infer<typeof Info>

  /**
   * 项目事件定义
   *
   * 定义项目相关的事件类型。
   */
  export const Event = {
    // 项目更新事件
    Updated: BusEvent.define("project.updated", Info),
  }

  /**
   * 从目录路径识别或创建项目
   *
   * 根据指定的目录路径，识别或创建一个项目。
   * 使用 Git 根提交哈希作为项目唯一标识符。
   *
   * @param directory - 要识别的目录路径
   * @returns Promise，解析为项目信息和沙盒目录
   *
   * 处理流程：
   * 1. 向上查找 .git 目录
   * 2. 如果找到 .git：
   *    - 检查是否有缓存的 ID（.git/opencode 文件）
   *    - 如果没有缓存，获取 Git 根提交哈希作为 ID
   *    - 解析工作树和沙盒路径
   * 3. 如果没找到 .git：
   *    - 使用 "global" 作为 ID
   * 4. 读取或创建项目信息
   * 5. 更新时间戳和沙盒列表
   * 6. 发射项目更新事件
   *
   * Git 命令说明：
   * - git rev-list --max-parents=0 --all：获取所有根提交（没有父提交的提交）
   * - git rev-parse --show-toplevel：显示工作树根目录
   * - git rev-parse --git-common-dir：显示 Git 公共目录
   *
   * @example
   * ```typescript
   * const { project, sandbox } = await Project.fromDirectory("/path/to/repo")
   * console.log(project.id)  // Git 根提交哈希
   * ```
   */
  export async function fromDirectory(directory: string) {
    // 记录正在处理的目录
    log.info("fromDirectory", { directory })

    // 使用 IIFE 执行项目识别逻辑
    // 返回：id（项目 ID）、sandbox（沙盒路径）、worktree（工作树路径）、vcs（版本控制系统）
    const { id, sandbox, worktree, vcs } = await iife(async () => {
      // 向上查找 .git 目录
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      // 获取第一个匹配项（最近的 .git 目录）
      const git = await matches.next().then((x) => x.value)
      // 关闭迭代器
      await matches.return()

      // 如果找到了 .git 目录
      if (git) {
        // 沙盒路径是 .git 目录的父目录
        let sandbox = path.dirname(git)

        // 查找 git 可执行文件
        const gitBinary = Bun.which("git")

        // 尝试从缓存文件读取项目 ID
        // 缓存文件位于 .git/opencode
        let id = await Bun.file(path.join(git, "opencode"))
          .text() // 读取文件内容
          .then((x) => x.trim()) // 去除首尾空白
          .catch(() => undefined) // 文件不存在则返回 undefined

        // 如果没有找到 git 可执行文件
        if (!gitBinary) {
          return {
            // 使用缓存的 ID 或默认为 "global"
            id: id ?? "global",
            // 工作树就是沙盒目录
            worktree: sandbox,
            sandbox: sandbox,
            // 使用假的 VCS 标志
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        // 如果没有缓存的 ID，从 Git 根提交生成
        if (!id) {
          // 获取所有根提交（没有父提交的提交）
          // --max-parents=0：只选择没有父提交的提交
          // --all：从所有引用中查找
          const roots = await $`git rev-list --max-parents=0 --all`
            .quiet() // 静默模式，不输出到 stdout
            .nothrow() // 不在错误时抛出异常
            .cwd(sandbox) // 在沙盒目录中执行
            .text() // 获取文本输出
            .then((x) =>
              x
                .split("\n") // 按行分割
                .filter(Boolean) // 过滤空行
                .map((x) => x.trim()) // 去除每行空白
                .toSorted(), // 排序以确保一致性
            )
            .catch(() => undefined) // 命令失败则返回 undefined

          // 如果没有获取到根提交
          if (!roots) {
            return {
              id: "global", // 使用全局 ID
              worktree: sandbox,
              sandbox: sandbox,
              vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
            }
          }

          // 使用第一个根提交作为项目 ID
          id = roots[0]
          if (id) {
            // 将 ID 写入缓存文件，加速后续识别
            void Bun.file(path.join(git, "opencode"))
              .write(id) // 写入 ID
              .catch(() => undefined) // 忽略写入错误
          }
        }

        // 如果仍然没有有效的 ID
        if (!id) {
          return {
            id: "global",
            worktree: sandbox,
            sandbox: sandbox,
            vcs: "git", // 使用 git 作为 VCS 类型
          }
        }

        // 获取 Git 工作树的顶级目录
        // --show-toplevel：显示工作树根目录
        const top = await $`git rev-parse --show-toplevel`
          .quiet()
          .nothrow()
          .cwd(sandbox) // 在沙盒目录中执行
          .text()
          .then((x) => path.resolve(sandbox, x.trim())) // 解析为绝对路径
          .catch(() => undefined)

        // 如果没有获取到顶级目录
        if (!top) {
          return {
            id, // 使用已获取的 ID
            sandbox, // 使用当前的沙盒路径
            worktree: sandbox, // 工作树等于沙盒
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        // 更新沙盒路径为顶级目录
        sandbox = top

        // 获取 Git 公共目录
        // --git-common-dir：显示 Git 公共目录（用于工作树）
        const worktree = await $`git rev-parse --git-common-dir`
          .quiet()
          .nothrow()
          .cwd(sandbox)
          .text()
          .then((x) => {
            // 获取目录名
            const dirname = path.dirname(x.trim())
            // 如果目录名是 "."，说明就是当前目录
            if (dirname === ".") return sandbox
            // 否则返回解析后的路径
            return dirname
          })
          .catch(() => undefined)

        // 如果没有获取到公共目录
        if (!worktree) {
          return {
            id,
            sandbox,
            worktree: sandbox, // 工作树等于沙盒
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        // 返回完整的项目信息
        return {
          id, // 项目 ID（根提交哈希）
          sandbox, // 沙盒路径
          worktree, // 工作树路径
          vcs: "git", // VCS 类型
        }
      }

      // 没有找到 .git 目录，返回全局项目
      return {
        id: "global", // 全局项目 ID
        worktree: "/", // 工作树为根目录
        sandbox: "/", // 沙盒为根目录
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS), // 假的 VCS
      }
    })

    // 尝试从存储中读取现有的项目信息
    let existing = await Storage.read<Info>(["project", id]).catch(() => undefined)

    // 如果项目不存在，创建新的项目信息
    if (!existing) {
      existing = {
        id, // 项目 ID
        worktree, // 工作树路径
        vcs: vcs as Info["vcs"], // VCS 类型
        sandboxes: [], // 初始为空的沙盒列表
        time: {
          created: Date.now(), // 创建时间
          updated: Date.now(), // 更新时间
        },
      }
      // 如果不是全局项目，尝试从全局项目迁移会话
      if (id !== "global") {
        await migrateFromGlobal(id, worktree)
      }
    }

    // 向后兼容：确保 sandboxes 字段存在
    if (!existing.sandboxes) existing.sandboxes = []

    // 如果启用了实验性的图标发现功能
    if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)

    // 构造更新后的项目信息
    const result: Info = {
      ...existing, // 保留现有信息
      worktree, // 更新工作树路径
      vcs: vcs as Info["vcs"], // 更新 VCS 类型
      time: {
        // 保留现有时间，只更新 updated
        ...existing.time,
        updated: Date.now(),
      },
    }

    // 如果当前沙盒不同于工作树，且不在沙盒列表中，添加它
    if (sandbox !== result.worktree && !result.sandboxes.includes(sandbox)) {
      result.sandboxes.push(sandbox)
    }

    // 过滤掉不存在的沙盒目录
    result.sandboxes = result.sandboxes.filter((x) => existsSync(x))

    // 将更新后的项目信息写入存储
    await Storage.write<Info>(["project", id], result)

    // 向全局事件总线发射项目更新事件
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type, // 事件类型
        properties: result, // 项目信息
      },
    })

    // 返回项目信息和当前沙盒路径
    return { project: result, sandbox }
  }

  /**
   * 发现项目图标
   *
   * 在项目工作树中查找 favicon 文件，并将其转换为 Data URL。
   *
   * @param input - 项目信息对象
   * @returns Promise，完成时图标已更新
   *
   * 处理流程：
   * 1. 检查是否是 Git 项目且还没有图标
   * 2. 扫描工作树中的 favicon 文件
   * 3. 选择路径最短的文件（最可能是根目录的图标）
   * 4. 读取文件并转换为 base64 Data URL
   * 5. 更新项目信息
   *
   * 支持的文件格式：
   * - .ico
   * - .png
   * - .svg
   * - .jpg
   * - .jpeg
   * - .webp
   *
   * @example
   * ```typescript
   * await Project.discover(projectInfo)
   * // projectInfo.icon.url 将包含 base64 编码的图标
   * ```
   */
  export async function discover(input: Info) {
    // 只处理 Git 项目
    if (input.vcs !== "git") return
    // 如果已经有图标，跳过
    if (input.icon?.url) return

    // 创建 Glob 模式，匹配 favicon 文件
    // **/{favicon}.{ico,png,svg,jpg,jpeg,webp}
    const glob = new Bun.Glob("**/{favicon}.{ico,png,svg,jpg,jpeg,webp}")

    // 扫描工作树，收集所有匹配的文件
    const matches = await Array.fromAsync(
      glob.scan({
        cwd: input.worktree, // 在工作树目录中扫描
        absolute: true, // 返回绝对路径
        onlyFiles: true, // 只要文件
        followSymlinks: false, // 不跟随符号链接
        dot: false, // 不搜索隐藏目录
      }),
    )

    // 选择路径最短的文件（最可能是根目录的图标）
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return // 没有找到图标文件

    // 读取文件内容
    const file = Bun.file(shortest)
    const buffer = await file.arrayBuffer()
    // 转换为 base64
    const base64 = Buffer.from(buffer).toString("base64")
    // 获取 MIME 类型
    const mime = file.type || "image/png"
    // 构造 Data URL
    const url = `data:${mime};base64,${base64}`

    // 更新项目图标
    await update({
      projectID: input.id,
      icon: {
        url, // Data URL
      },
    })
    return
  }

  /**
   * 从全局项目迁移会话到指定项目
   *
   * 将存储在全局项目下的会话迁移到具体的项目下。
   *
   * @param newProjectID - 目标项目 ID
   * @param worktree - 工作树路径
   *
   * 处理流程：
   * 1. 读取全局项目信息
   * 2. 列出全局项目下的所有会话
   * 3. 并发处理每个会话：
   *    - 检查会话目录是否匹配工作树
   *    - 更新会话的 projectID
   *    - 将会话移动到新项目下
   *
   * @example
   * ```typescript
   * await migrateFromGlobal("abc123", "/path/to/repo")
   * // 全局项目中匹配的会话将被迁移到项目 abc123
   * ```
   */
  async function migrateFromGlobal(newProjectID: string, worktree: string) {
    // 读取全局项目信息
    const globalProject = await Storage.read<Info>(["project", "global"]).catch(() => undefined)
    if (!globalProject) return // 全局项目不存在

    // 列出全局项目下的所有会话
    const globalSessions = await Storage.list(["session", "global"]).catch(() => [])
    if (globalSessions.length === 0) return // 没有会话需要迁移

    // 记录迁移信息
    log.info("migrating sessions from global", { newProjectID, worktree, count: globalSessions.length })

    // 使用工作队列并发处理会话（最多 10 个并发）
    await work(10, globalSessions, async (key) => {
      // 获取会话 ID（键的最后一个元素）
      const sessionID = key[key.length - 1]
      // 读取会话信息
      const session = await Storage.read<Session.Info>(key).catch(() => undefined)
      if (!session) return // 会话不存在

      // 检查会话目录是否匹配工作树
      if (session.directory && session.directory !== worktree) return

      // 更新会话的 projectID
      session.projectID = newProjectID
      log.info("migrating session", { sessionID, from: "global", to: newProjectID })

      // 将会话写入新项目下
      await Storage.write(["session", newProjectID, sessionID], session)
      // 删除旧位置的会话
      await Storage.remove(key)
    }).catch((error) => {
      // 记录迁移失败
      log.error("failed to migrate sessions from global to project", { error, projectId: newProjectID })
    })
  }

  /**
   * 设置项目初始化时间
   *
   * 标记项目已完成初始化。
   *
   * @param projectID - 项目 ID
   * @returns Promise，完成时初始化时间已设置
   *
   * @example
   * ```typescript
   * await Project.setInitialized("abc123")
   * ```
   */
  export async function setInitialized(projectID: string) {
    // 更新项目的 initialized 时间戳
    await Storage.update<Info>(["project", projectID], (draft) => {
      draft.time.initialized = Date.now()
    })
  }

  /**
   * 列出所有项目
   *
   * 从存储中读取所有项目信息。
   *
   * @returns Promise，解析为项目信息数组
   *
   * @example
   * ```typescript
   * const projects = await Project.list()
   * console.log("共有", projects.length, "个项目")
   * ```
   */
  export async function list() {
    // 列出所有项目键
    const keys = await Storage.list(["project"])
    // 并发读取所有项目信息
    return await Promise.all(keys.map((x) => Storage.read<Info>(x)))
  }

  /**
   * 更新项目信息
   *
   * 使用 fn 包装器创建类型安全的更新函数。
   * 支持更新项目名称和图标。
   *
   * @param input - 更新参数
   *   - projectID：项目 ID
   *   - name：新名称（可选）
   *   - icon：新图标（可选）
   * @returns Promise，解析为更新后的项目信息
   *
   * @example
   * ```typescript
   * await Project.update({
   *   projectID: "abc123",
   *   name: "新名称",
   *   icon: { url: "data:image/png;base64,..." }
   * })
   * ```
   */
  export const update = fn(
    // 输入参数 Schema
    z.object({
      // 项目 ID
      projectID: z.string(),
      // 新名称（可选）
      name: z.string().optional(),
      // 新图标（可选）
      icon: Info.shape.icon.optional(),
    }),
    // 更新函数
    async (input) => {
      // 更新存储中的项目信息
      const result = await Storage.update<Info>(["project", input.projectID], (draft) => {
        // 如果提供了名称，更新它
        if (input.name !== undefined) draft.name = input.name
        // 如果提供了图标，更新它
        if (input.icon !== undefined) {
          // 保留现有图标属性
          draft.icon = {
            ...draft.icon,
          }
          // 更新 URL（如果提供）
          if (input.icon.url !== undefined) draft.icon.url = input.icon.url
          // 更新颜色（如果提供）
          if (input.icon.color !== undefined) draft.icon.color = input.icon.color
        }
        // 更新时间戳
        draft.time.updated = Date.now()
      })

      // 发射项目更新事件
      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: result,
        },
      })

      // 返回更新后的项目信息
      return result
    },
  )

  /**
   * 获取有效的沙盒目录列表
   *
   * 返回项目中所有实际存在的沙盒目录。
   *
   * @param projectID - 项目 ID
   * @returns Promise，解析为有效的沙盒路径数组
   *
   * 处理流程：
   * 1. 读取项目信息
   * 2. 遍历沙盒列表
   * 3. 检查每个路径是否是存在的目录
   * 4. 返回有效的路径列表
   *
   * @example
   * ```typescript
   * const validSandboxes = await Project.sandboxes("abc123")
   * console.log("有效沙盒:", validSandboxes)
   * ```
   */
  export async function sandboxes(projectID: string) {
    // 读取项目信息
    const project = await Storage.read<Info>(["project", projectID]).catch(() => undefined)
    if (!project?.sandboxes) return [] // 没有沙盒列表

    // 存储有效的沙盒路径
    const valid: string[] = []

    // 遍历沙盒列表
    for (const dir of project.sandboxes) {
      // 检查路径是否存在且是目录
      const stat = await fs.stat(dir).catch(() => undefined)
      if (stat?.isDirectory()) {
        valid.push(dir) // 添加到有效列表
      }
    }

    return valid
  }
}
