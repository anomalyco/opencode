/**
 * ============================================================================
 * 文件名：storage.ts
 * 所属包：packages/opencode/src/storage
 * ============================================================================
 *
 * 文件作用：
 * 持久化存储模块。提供键值对形式的文件存储和数据迁移功能。
 *
 * 主要功能：
 * - read()：读取存储的值
 * - write()：写入值
 * - update()：更新现有值
 * - remove()：删除值
 * - list()：列出指定前缀的所有键
 * - 数据迁移系统
 * - 读写锁保护
 *
 * 依赖关系：
 * - ../util/log：日志模块
 * - path：Node.js 路径处理
 * - fs/promises：异步文件操作
 * - ../global：全局路径配置
 * - ../util/lazy：惰性初始化
 * - ../util/lock：读写锁
 * - bun：Bun 运行时
 * - @opencode-ai/util/error：错误处理
 * - zod：类型验证
 *
 * 导出内容：
 * - Storage namespace：存储命名空间
 *   - NotFoundError：未找到错误类
 *   - read(key)：读取值
 *   - write(key, content)：写入值
 *   - update(key, fn)：更新值
 *   - remove(key)：删除值
 *   - list(prefix)：列出键
 *
 * 存储结构：
 * - 目录：{data}/storage/
 * - 文件：{key}.json
 * - 格式：JSON
 * - 示例：session/abc123.json, message/def456.json
 *
 * 迁移系统：
 * - 按顺序执行迁移函数
 * - 记录已执行的迁移版本
 * - 支持项目结构迁移
 * - 支持会话数据迁移
 *
 * 并发控制：
 * - 使用读写锁保护文件访问
 * - 多个读者可以并发
 * - 写者独占访问
 *
 * 使用场景：
 * - 会话数据持久化
 * - 消息存储
 * - 项目配置存储
 * - 任何需要持久化的键值对数据
 *
 * 使用示例：
 * ```typescript
 * // 写入数据
 * await Storage.write(["session", "abc123"], {
 *   id: "abc123",
 *   created: Date.now()
 * })
 *
 * // 读取数据
 * const session = await Storage.read<Session>(["session", "abc123"])
 *
 * // 更新数据
 * await Storage.update(["session", "abc123"], (draft) => {
 *   draft.updated = Date.now()
 * })
 *
 * // 删除数据
 * await Storage.remove(["session", "abc123"])
 *
 * // 列出所有会话
 * const sessions = await Storage.list(["session"])
 * // [["session", "abc123"], ["session", "def456"]]
 * ```
 *
 * @package opencode
 * @module storage
 */

// 导入日志模块
import { Log } from "../util/log"

// 导入路径处理模块
import path from "path"

// 导入异步文件操作
import fs from "fs/promises"

// 导入全局路径配置
import { Global } from "../global"

// 导入惰性初始化工具
import { lazy } from "../util/lazy"

// 导入读写锁
import { Lock } from "../util/lock"

// 导入 Bun 的 shell 命令
import { $ } from "bun"

// 导入错误处理工具
import { NamedError } from "@opencode-ai/util/error"

// 导入 Zod 类型验证
import z from "zod"

/**
 * 存储命名空间
 *
 * 提供持久化键值对存储功能。
 */
export namespace Storage {
  // 创建日志记录器
  const log = Log.create({ service: "storage" })

  /**
   * 迁移函数类型
   *
   * 迁移函数接收存储目录路径，执行数据迁移操作。
   */
  type Migration = (dir: string) => Promise<void>

  /**
   * 未找到错误类
   *
   * 当尝试读取不存在的键时抛出此错误。
   */
  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  /**
   * 数据迁移函数数组
   *
   * 按顺序执行的迁移函数列表。
   * 每个函数负责一个版本的迁移。
   */
  const MIGRATIONS: Migration[] = [
    /**
     * 迁移 #0：项目结构迁移
     *
     * 将旧的项目目录结构迁移到新的结构：
     * - 使用 Git 根提交哈希作为项目 ID
     * - 重新组织会话和消息存储
     */
    async (dir) => {
      // 旧项目目录路径
      const project = path.resolve(dir, "../project")
      if (!fs.exists(project)) return  // 如果不存在则跳过

      // 遍历所有项目目录
      for await (const projectDir of new Bun.Glob("*").scan({
        cwd: project,
        onlyFiles: false,
      })) {
        log.info(`migrating project ${projectDir}`)
        let projectID = projectDir
        const fullProjectDir = path.join(project, projectDir)
        let worktree = "/"

        // 处理非全局项目
        if (projectID !== "global") {
          // 查找会话消息以确定 worktree
          for await (const msgFile of new Bun.Glob("storage/session/message/*/*.json").scan({
            cwd: path.join(project, projectDir),
            absolute: true,
          })) {
            const json = await Bun.file(msgFile).json()
            worktree = json.path?.root
            if (worktree) break
          }
          if (!worktree) continue  // 没有 worktree 则跳过

          // 检查 worktree 是否存在
          if (!(await fs.exists(worktree))) continue

          // 获取 Git 根提交哈希作为项目 ID
          const [id] = await $`git rev-list --max-parents=0 --all`
            .quiet()
            .nothrow()
            .cwd(worktree)
            .text()
            .then((x) =>
              x
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
          if (!id) continue
          projectID = id

          // 写入新的项目配置
          await Bun.write(
            path.join(dir, "project", projectID + ".json"),
            JSON.stringify({
              id,
              vcs: "git",
              worktree,
              time: {
                created: Date.now(),
                initialized: Date.now(),
              },
            }),
          )

          // 迁移会话数据
          log.info(`migrating sessions for project ${projectID}`)
          for await (const sessionFile of new Bun.Glob("storage/session/info/*.json").scan({
            cwd: fullProjectDir,
            absolute: true,
          })) {
            // 复制会话信息
            const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
            log.info("copying", {
              sessionFile,
              dest,
            })
            const session = await Bun.file(sessionFile).json()
            await Bun.write(dest, JSON.stringify(session))

            // 迁移该会话的消息
            log.info(`migrating messages for session ${session.id}`)
            for await (const msgFile of new Bun.Glob(`storage/session/message/${session.id}/*.json`).scan({
              cwd: fullProjectDir,
              absolute: true,
            })) {
              const dest = path.join(dir, "message", session.id, path.basename(msgFile))
              log.info("copying", {
                msgFile,
                dest,
              })
              const message = await Bun.file(msgFile).json()
              await Bun.write(dest, JSON.stringify(message))

              // 迁移该消息的部分
              log.info(`migrating parts for message ${message.id}`)
              for await (const partFile of new Bun.Glob(`storage/session/part/${session.id}/${message.id}/*.json`).scan(
                {
                  cwd: fullProjectDir,
                  absolute: true,
                },
              )) {
                const dest = path.join(dir, "part", message.id, path.basename(partFile))
                const part = await Bun.file(partFile).json()
                log.info("copying", {
                  partFile,
                  dest,
                })
                await Bun.write(dest, JSON.stringify(part))
              }
            }
          }
        }
      }
    },

    /**
     * 迁移 #1：会话差异摘要迁移
     *
     * 将会话的 diffs 数据提取到单独文件，
     * 并计算总体的 additions 和 deletions。
     */
    async (dir) => {
      // 遍历所有会话文件
      for await (const item of new Bun.Glob("session/*/*.json").scan({
        cwd: dir,
        absolute: true,
      })) {
        const session = await Bun.file(item).json()
        if (!session.projectID) continue  // 跳过没有 projectID 的会话
        if (!session.summary?.diffs) continue  // 跳过没有 diffs 的会话

        const { diffs } = session.summary

        // 将 diffs 写入单独文件
        await Bun.file(path.join(dir, "session_diff", session.id + ".json")).write(JSON.stringify(diffs))

        // 更新会话，用汇总数据替换 diffs
        await Bun.file(path.join(dir, "session", session.projectID, session.id + ".json")).write(
          JSON.stringify({
            ...session,
            summary: {
              additions: diffs.reduce((sum: any, x: any) => sum + x.additions, 0),  // 总新增行数
              deletions: diffs.reduce((sum: any, x: any) => sum + x.deletions, 0),  // 总删除行数
            },
          }),
        )
      }
    },
  ]

  /**
   * 惰性初始化的存储状态
   *
   * 在首次访问时执行必要的迁移。
   */
  const state = lazy(async () => {
    // 存储目录路径
    const dir = path.join(Global.Path.data, "storage")

    // 读取当前迁移版本
    const migration = await Bun.file(path.join(dir, "migration"))
      .json()
      .then((x) => parseInt(x))  // 解析为整数
      .catch(() => 0)             // 不存在则从 0 开始

    // 执行所有未执行的迁移
    for (let index = migration; index < MIGRATIONS.length; index++) {
      log.info("running migration", { index })
      const migration = MIGRATIONS[index]
      await migration(dir).catch(() => log.error("failed to run migration", { index }))
      // 记录迁移版本
      await Bun.write(path.join(dir, "migration"), (index + 1).toString())
    }

    return {
      dir,
    }
  })

  /**
   * 删除指定键的数据
   *
   * @param key - 键路径（数组形式，如 ["session", "abc123"]）
   * @returns Promise，删除完成时 resolve
   *
   * @example
   * ```typescript
   * await Storage.remove(["session", "abc123"])
   * // 删除 {storage}/session/abc123.json
   * ```
   */
  export async function remove(key: string[]) {
    // 获取存储目录
    const dir = await state().then((x) => x.dir)
    // 构造目标文件路径
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      // 尝试删除文件（不存在则忽略）
      await fs.unlink(target).catch(() => {})
    })
  }

  /**
   * 读取指定键的数据
   *
   * @param key - 键路径（数组形式）
   * @returns Promise，解析为读取的数据
   *
   * 使用读锁保护，允许多个并发读操作。
   *
   * @template T - 数据类型
   *
   * @example
   * ```typescript
   * const session = await Storage.read<SessionData>(["session", "abc123"])
   * ```
   */
  export async function read<T>(key: string[]) {
    // 获取存储目录
    const dir = await state().then((x) => x.dir)
    // 构造目标文件路径
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      // 获取读锁（自动释放）
      using _ = await Lock.read(target)
      // 读取并解析 JSON
      const result = await Bun.file(target).json()
      return result as T
    })
  }

  /**
   * 更新指定键的数据
   *
   * @param key - 键路径
   * @param fn - 更新函数，接收当前值的引用
   * @returns Promise，解析为更新后的数据
   *
   * 使用写锁保护，确保独占访问。
   *
   * @template T - 数据类型
   *
   * @example
   * ```typescript
   * await Storage.update(["session", "abc123"], (draft) => {
   *   draft.updated = Date.now()
   * })
   * ```
   */
  export async function update<T>(key: string[], fn: (draft: T) => void) {
    // 获取存储目录
    const dir = await state().then((x) => x.dir)
    // 构造目标文件路径
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      // 获取写锁（自动释放）
      using _ = await Lock.write(target)
      // 读取现有内容
      const content = await Bun.file(target).json()
      // 调用更新函数修改内容
      fn(content)
      // 写回文件
      await Bun.write(target, JSON.stringify(content, null, 2))
      return content as T
    })
  }

  /**
   * 写入数据到指定键
   *
   * @param key - 键路径
   * @param content - 要写入的内容
   * @returns Promise，写入完成时 resolve
   *
   * 使用写锁保护，确保独占访问。
   *
   * @template T - 数据类型
   *
   * @example
   * ```typescript
   * await Storage.write(["session", "abc123"], {
   *   id: "abc123",
   *   created: Date.now()
   * })
   * ```
   */
  export async function write<T>(key: string[], content: T) {
    // 获取存储目录
    const dir = await state().then((x) => x.dir)
    // 构造目标文件路径
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      // 获取写锁（自动释放）
      using _ = await Lock.write(target)
      // 写入 JSON 格式的内容
      await Bun.write(target, JSON.stringify(content, null, 2))
    })
  }

  /**
   * 带错误处理的包装函数
   *
   * 捕获文件系统错误并转换为适当的错误类型。
   *
   * @param body - 要执行的异步函数
   * @returns Promise，执行结果
   *
   * 错误处理：
   * - ENOENT（文件不存在）：转换为 NotFoundError
   * - 其他错误：直接抛出
   */
  async function withErrorHandling<T>(body: () => Promise<T>) {
    return body().catch((e) => {
      // 只处理 Error 类型
      if (!(e instanceof Error)) throw e
      const errnoException = e as NodeJS.ErrnoException

      // 文件不存在错误
      if (errnoException.code === "ENOENT") {
        throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
      }
      throw e
    })
  }

  /**
   * 全局匹配器，用于列出文件
   */
  const glob = new Bun.Glob("**/*")

  /**
   * 列出指定前缀的所有键
   *
   * @param prefix - 键前缀（数组形式）
   * @returns Promise，解析为键路径数组
   *
   * 返回的键路径是嵌套数组形式：
   * - 例如：[["session", "abc123"], ["session", "def456"]]
   *
   * @example
   * ```typescript
   * const sessions = await Storage.list(["session"])
   * // [["session", "abc123"], ["session", "def456"]]
   *
   * const messages = await Storage.list(["message", "abc123"])
   * // [["message", "abc123", "msg1"], ["message", "abc123", "msg2"]]
   * ```
   */
  export async function list(prefix: string[]) {
    // 获取存储目录
    const dir = await state().then((x) => x.dir)
    try {
      // 扫描指定前缀目录下的所有文件
      const result = await Array.fromAsync(
        glob.scan({
          cwd: path.join(dir, ...prefix),
          onlyFiles: true,
        }),
      ).then((results) =>
        // 移除 .json 扩展名并分割路径
        results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)])
      )
      // 按字母顺序排序
      result.sort()
      return result
    } catch {
      // 目录不存在等错误，返回空数组
      return []
    }
  }
}
