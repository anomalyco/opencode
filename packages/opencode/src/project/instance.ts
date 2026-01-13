/**
 * ============================================================================
 * 文件名：instance.ts
 * 所属包：packages/opencode/src/project
 * ============================================================================
 *
 * 文件作用：
 * 实例管理模块。提供 OpenCode 实例的创建、上下文管理和生命周期控制。
 *
 * 主要功能：
 * - provide()：提供实例上下文并执行函数
 * - directory/worktree/project：获取当前实例属性
 * - containsPath()：检查路径是否在项目边界内
 * - state()：创建实例级别的状态
 * - dispose()：释放当前实例
 * - disposeAll()：释放所有实例
 *
 * 依赖关系：
 * - ../util/log：日志记录
 * - ../util/context：异步上下文管理
 * - ./project：项目识别和管理
 * - ./state：状态管理
 * - ../util/iife：立即执行函数表达式
 * - ../bus/global：全局事件总线
 * - ../util/filesystem：文件系统工具
 *
 * 导出内容：
 * - Instance namespace：实例管理命名空间
 *   - provide(input)：提供实例上下文并执行函数
 *   - directory：当前实例的工作目录
 *   - worktree：当前实例的工作树根目录
 *   - project：当前实例的项目信息
 *   - containsPath(filepath)：检查路径是否在项目内
 *   - state(init, dispose)：创建实例级别的状态
 *   - dispose()：释放当前实例
 *   - disposeAll()：释放所有实例
 *
 * 实例概念：
 * - 实例代表一个 OpenCode 工作环境
 * - 每个实例有独立的工作目录、项目信息和状态
 * - 使用 AsyncLocalStorage 管理上下文
 * - 实例可缓存，同一目录共享同一实例
 *
 * 生命周期：
 * 1. 首次访问目录时创建实例
 * 2. 识别或创建项目信息
 * 3. 运行初始化函数
 * 4. 执行工作函数
 * 5. 释放实例资源
 *
 * 使用示例：
 * ```typescript
 * // 执行需要实例上下文的代码
 * const result = await Instance.provide({
 *   directory: "/path/to/project",
 *   init: async () => {
 *     // 初始化逻辑
 *   },
 *   fn: async () => {
 *     // 工作逻辑，可访问 Instance.directory 等
 *     console.log(Instance.directory)
 *     return doSomething()
 *   }
 * })
 *
 * // 检查路径是否在项目内
 * if (Instance.containsPath("/path/to/file")) {
 *   // 路径在项目边界内
 * }
 *
 * // 创建实例级别的状态
 * const getState = Instance.state(
 *   () => ({ count: 0 }),
 *   async (state) => {
 *     // 清理逻辑
 *   }
 * )
 * const state = getState()
 * ```
 *
 * @package opencode
 * @module project/instance
 */

// 导入日志模块
import { Log } from "@/util/log"

// 导入异步上下文管理模块
import { Context } from "../util/context"

// 导入项目识别和管理模块
import { Project } from "./project"

// 导入状态管理模块
import { State } from "./state"

// 导入 IIFE 工具
import { iife } from "@/util/iife"

// 导入全局事件总线
import { GlobalBus } from "@/bus/global"

// 导入文件系统工具
import { Filesystem } from "@/util/filesystem"

/**
 * 实例上下文接口
 *
 * 定义实例上下文包含的信息。
 */
interface Context {
  // 工作目录路径
  directory: string
  // 工作树根目录路径
  worktree: string
  // 项目信息
  project: Project.Info
}

// 创建实例上下文
// 使用 "instance" 作为上下文名称
const context = Context.create<Context>("instance")

// 实例缓存
// 键是目录路径，值是上下文 Promise
const cache = new Map<string, Promise<Context>>()

/**
 * 实例管理命名空间
 *
 * 提供实例的创建、访问和生命周期管理功能。
 */
export const Instance = {
  /**
   * 提供实例上下文并执行函数
   *
   * 为指定目录创建（或复用）实例，并在实例上下文中执行函数。
   *
   * @param input - 配置对象
   *   - directory：工作目录路径
   *   - init：可选的初始化函数
   *   - fn：要在实例上下文中执行的函数
   * @returns Promise，解析为函数的返回值
   *
   * 处理流程：
   * 1. 检查缓存中是否已有该目录的实例
   * 2. 如果没有，创建新实例：
   *    - 识别或创建项目
   *    - 设置实例上下文
   *    - 运行初始化函数
   * 3. 在实例上下文中执行工作函数
   * 4. 返回执行结果
   *
   * @example
   * ```typescript
   * const result = await Instance.provide({
   *   directory: "/path/to/project",
   *   init: async () => {
   *     // 初始化，只在首次创建实例时执行
   *     console.log("初始化实例")
   *   },
   *   fn: async () => {
   *     // 工作逻辑，每次调用都会执行
   *     console.log(Instance.directory) // "/path/to/project"
   *     return "完成"
   *   }
   * })
   * ```
   */
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    // 尝试从缓存获取现有实例
    let existing = cache.get(input.directory)

    // 如果缓存中没有，创建新实例
    if (!existing) {
      // 记录正在创建实例
      Log.Default.info("creating instance", { directory: input.directory })

      // 使用 IIFE 创建实例上下文
      existing = iife(async () => {
        // 从目录识别或创建项目
        const { project, sandbox } = await Project.fromDirectory(input.directory)

        // 构造实例上下文
        const ctx = {
          directory: input.directory, // 工作目录
          worktree: sandbox, // 工作树根目录
          project, // 项目信息
        }

        // 在实例上下文中初始化
        await context.provide(ctx, async () => {
          // 运行用户提供的初始化函数（如果有）
          await input.init?.()
        })

        // 返回实例上下文
        return ctx
      })

      // 将实例上下文存入缓存
      cache.set(input.directory, existing)
    }

    // 等待实例上下文准备就绪
    const ctx = await existing

    // 在实例上下文中执行工作函数
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },

  /**
   * 获取当前实例的工作目录路径
   *
   * @returns 工作目录路径字符串
   *
   * @example
   * ```typescript
   * const dir = Instance.directory // "/path/to/project"
   * ```
   */
  get directory() {
    // 从上下文中获取 directory 字段
    return context.use().directory
  },

  /**
   * 获取当前实例的工作树根目录路径
   *
   * @returns 工作树根目录路径字符串
   *
   * @example
   * ```typescript
   * const tree = Instance.worktree // "/path/to/git/root"
   * ```
   */
  get worktree() {
    // 从上下文中获取 worktree 字段
    return context.use().worktree
  },

  /**
   * 获取当前实例的项目信息
   *
   * @returns 项目信息对象
   *
   * @example
   * ```typescript
   * const proj = Instance.project
   * console.log(proj.id) // 项目 ID
   * ```
   */
  get project() {
    // 从上下文中获取 project 字段
    return context.use().project
  },

  /**
   * 检查路径是否在项目边界内
   *
   * 判断指定路径是否在当前实例的工作目录或工作树内。
   * 这用于确定是否需要 external_directory 权限。
   *
   * @param filepath - 要检查的文件路径
   * @returns 如果路径在项目边界内返回 true
   *
   * 判断逻辑：
   * 1. 检查路径是否在 directory 内
   * 2. 如果不在，检查是否在 worktree 内
   * 3. 特殊处理：非 Git 项目的 worktree 是 "/"，跳过此检查
   *
   * 权限含义：
   * - 返回 true：路径在项目内，不需要 external_directory 权限
   * - 返回 false：路径在项目外，需要 external_directory 权限
   *
   * @example
   * ```typescript
   * Instance.containsPath("/path/to/project/src/file.ts") // true
   * Instance.containsPath("/other/project/file.ts")        // false
   * ```
   */
  containsPath(filepath: string) {
    // 检查路径是否在目录内
    if (Filesystem.contains(Instance.directory, filepath)) return true

    // 非 Git 项目的 worktree 是 "/"，会匹配所有绝对路径
    // 跳过 worktree 检查，保留 external_directory 权限
    if (Instance.worktree === "/") return false

    // 检查路径是否在工作树内
    return Filesystem.contains(Instance.worktree, filepath)
  },

  /**
   * 创建实例级别的状态
   *
   * 创建一个在实例生命周期内缓存的状态对象。
   * 同一个实例的多次调用返回相同的状态。
   *
   * @param init - 状态初始化函数
   * @param dispose - 可选的状态清理函数
   * @returns 状态获取函数
   *
   * 工作原理：
   * 1. 使用 Instance.directory 作为状态根键
   * 2. 首次调用时执行 init 函数创建状态
   * 3. 后续调用直接返回缓存的状态
   * 4. 实例释放时执行 dispose 函数
   *
   * @example
   * ```typescript
   * const getConnection = Instance.state(
   *   () => {
   *     // 初始化：创建数据库连接
   *     return createConnection()
   *   },
   *   async (conn) => {
   *     // 清理：关闭连接
   *     await conn.close()
   *   }
   * )
   *
   * // 使用状态
   * const conn = getConnection()
   * ```
   */
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    // 使用 State.create 创建状态，以实例目录为根键
    return State.create(() => Instance.directory, init, dispose)
  },

  /**
   * 释放当前实例
   *
   * 清理当前实例的所有状态和资源。
   *
   * @returns Promise，完成时实例已释放
   *
   * 处理流程：
   * 1. 记录释放日志
   * 2. 调用所有状态的清理函数
   * 3. 从缓存中移除实例
   * 4. 发射实例释放事件
   *
   * @example
   * ```typescript
   * await Instance.dispose()
   * ```
   */
  async dispose() {
    // 记录正在释放实例
    Log.Default.info("disposing instance", { directory: Instance.directory })

    // 释放该实例目录下的所有状态
    await State.dispose(Instance.directory)

    // 从缓存中移除实例
    cache.delete(Instance.directory)

    // 向全局事件总线发射实例释放事件
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory: Instance.directory,
        },
      },
    })
  },

  /**
   * 释放所有实例
   *
   * 清理所有缓存的实例及其状态。
   *
   * @returns Promise，完成时所有实例已释放
   *
   * 处理流程：
   * 1. 记录释放日志
   * 2. 遍历所有缓存实例
   * 3. 在各自的上下文中调用 dispose()
   * 4. 清空缓存
   *
   * @example
   * ```typescript
   * await Instance.disposeAll()
   * ```
   */
  async disposeAll() {
    // 记录正在释放所有实例
    Log.Default.info("disposing all instances")

    // 遍历所有缓存实例
    for (const [_key, value] of cache) {
      // 等待实例上下文准备就绪
      const awaited = await value.catch(() => {})

      // 如果实例存在，释放它
      if (awaited) {
        await context.provide(await value, async () => {
          await Instance.dispose()
        })
      }
    }

    // 清空缓存
    cache.clear()
  },
}
