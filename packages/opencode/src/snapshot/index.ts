/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/snapshot
 * ============================================================================
 *
 * 文件作用：
 * Git 快照管理模块。为工作目录创建独立的 Git 快照仓库，
 * 用于跟踪文件变更、支持回滚和差异比较。
 *
 * 主要功能：
 * - track()：创建当前状态的快照
 * - patch(hash)：获取指定快照的差异文件列表
 * - restore(snapshot)：恢复到指定快照
 * - revert(patches)：回滚指定文件到快照状态
 * - diff(hash)：获取与指定快照的差异文本
 * - diffFull(from, to)：获取两个快照间的完整差异
 * - gitdir()：获取快照仓库目录路径
 *
 * 依赖关系：
 * - bun：Bun 运行时（shell 命令 $）
 * - path：Node.js 路径处理
 * - fs/promises：异步文件操作
 * - ../util/log：日志记录
 * - ../global：全局路径配置
 * - zod：类型验证
 * - ../config/config：配置系统
 * - ../project/instance：实例管理
 *
 * 导出内容：
 * - Snapshot namespace：快照管理命名空间
 *   - track()：创建快照
 *   - Patch Schema：补丁类型
 *   - patch(hash)：获取补丁
 *   - restore(snapshot)：恢复快照
 *   - revert(patches)：回滚文件
 *   - diff(hash)：获取差异
 *   - FileDiff Schema：文件差异类型
 *   - diffFull(from, to)：获取完整差异
 *
 * 工作原理：
 * 1. 快照仓库独立于项目的 Git 仓库
 * 2. 存储路径：{data}/snapshot/{projectID}/
 * 3. 使用 GIT_DIR 和 GIT_WORK_TREE 环境变量
 * 4. 支持增量快照和文件级回滚
 *
 * 使用场景：
 * - 在执行危险操作前创建快照
 * - 支持会话的回滚功能
 * - 比较不同状态的文件差异
 * - 恢复意外修改的文件
 *
 * @package opencode
 * @module snapshot
 */

// 导入 Bun shell 命令工具
import { $ } from "bun"

// 导入路径处理模块
import path from "path"

// 导入异步文件操作
import fs from "fs/promises"

// 导入日志模块
import { Log } from "../util/log"

// 导入全局路径配置
import { Global } from "../global"

// 导入 Zod 类型验证
import z from "zod"

// 导入配置系统
import { Config } from "../config/config"

// 导入实例管理
import { Instance } from "../project/instance"

/**
 * 快照管理命名空间
 *
 * 提供 Git 快照的创建、比较和恢复功能。
 */
export namespace Snapshot {
  // 创建日志记录器
  const log = Log.create({ service: "snapshot" })

  /**
   * 创建当前状态的快照
   *
   * 使用独立的 Git 仓库跟踪工作目录的当前状态。
   * 快照存储在全局数据目录下，与项目 Git 仓库独立。
   *
   * @returns Promise，解析为快照的 tree hash
   *
   * 处理流程：
   * 1. 检查是否为 Git 项目，不是则返回
   * 2. 检查配置是否禁用快照
   * 3. 初始化快照仓库（如果不存在）
   * 4. 添加所有文件到暂存区
   * 5. 使用 write-tree 创建快照
   * 6. 返回 tree hash
   *
   * 快照仓库特点：
   * - 独立于项目 Git 仓库
   * - 存储：{data}/snapshot/{projectID}/
   * - 使用 tree hash 而非 commit hash
   * - 自动初始化（首次调用时）
   *
   * @example
   * ```typescript
   * const hash = await Snapshot.track()
   * console.log(`Snapshot created: ${hash}`)
   * ```
   */
  export async function track() {
    // 非 Git 项目不支持快照
    if (Instance.project.vcs !== "git") return

    // 检查配置是否禁用快照
    const cfg = await Config.get()
    if (cfg.snapshot === false) return

    // 获取快照仓库目录
    const git = gitdir()

    // 初始化快照仓库（如果不存在）
    if (await fs.mkdir(git, { recursive: true })) {
      // 使用环境变量指定独立的 Git 目录
      await $`git init`
        .env({
          ...process.env,
          GIT_DIR: git,                  // Git 仓库目录
          GIT_WORK_TREE: Instance.worktree, // 工作树目录
        })
        .quiet()
        .nothrow()

      // 配置 Git 不转换行尾（Windows 兼容）
      await $`git --git-dir ${git} config core.autocrlf false`.quiet().nothrow()
      log.info("initialized")
    }

    // 添加所有文件到暂存区
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()

    // 创建 tree 对象作为快照
    const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()

    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash.trim()
  }

  /**
   * 补丁类型 Schema
   *
   * 定义文件变更补丁的数据结构。
   */
  export const Patch = z.object({
    // 快照的 tree hash
    hash: z.string(),
    // 相对于此快照变更的文件列表
    files: z.string().array(),
  })

  /**
   * 补丁类型
   *
   * 从 Patch Schema 推断的 TypeScript 类型。
   */
  export type Patch = z.infer<typeof Patch>

  /**
   * 获取指定快照的补丁
   *
   * 比较当前状态与指定快照，返回变更的文件列表。
   *
   * @param hash - 快照的 tree hash
   * @returns Promise，解析为补丁对象
   *
   * 处理流程：
   * 1. 添加当前所有文件到暂存区
   * 2. 使用 git diff 获取差异文件名
   * 3. 返回 hash 和文件列表
   *
   * 返回的文件路径是绝对路径。
   * 如果 git diff 失败，返回空文件列表。
   *
   * @example
   * ```typescript
   * const patch = await Snapshot.patch(snapshotHash)
   * console.log(`Changed files: ${patch.files.length}`)
   * ```
   */
  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()

    // 添加当前所有文件到暂存区
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()

    // 获取差异文件列表（仅文件名）
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()

    // 如果 git diff 失败，返回空补丁
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    // 解析文件列表，转换为绝对路径
    const files = result.text()
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => path.join(Instance.worktree, x)),
    }
  }

  /**
   * 恢复到指定快照
   *
   * 将工作目录完全恢复到指定快照的状态。
   *
   * @param snapshot - 快照的 tree hash
   * @returns Promise，恢复完成时 resolve
   *
   * 处理流程：
   * 1. 读取快照的 tree 到索引
   * 2. 检出索引到工作目录
   * 3. 所有文件恢复到快照时的状态
   *
   * 注意：此操作会覆盖工作目录的所有文件。
   *
   * @example
   * ```typescript
   * await Snapshot.restore(snapshotHash)
   * console.log("Restored to snapshot")
   * ```
   */
  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()

    // 读取 tree 并检出所有文件
    const result =
      await $`git --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    // 记录恢复失败的错误
    if (result.exitCode !== 0) {
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
    }
  }

  /**
   * 回滚指定文件到快照状态
   *
   * 对于补丁中的每个文件，恢复到对应快照的状态。
   *
   * @param patches - 补丁数组，每个包含快照 hash 和文件列表
   * @returns Promise，回滚完成时 resolve
   *
   * 处理流程：
   * 1. 遍历所有补丁和文件
   * 2. 使用 git checkout 从快照恢复文件
   * 3. 如果文件在快照中不存在，删除它
   * 4. 跳过已处理的文件（使用 Set 去重）
   *
   * 错误处理：
   * - checkout 失败时，检查文件是否存在于快照
   * - 不存在则删除文件
   * - 存在则保留文件并记录
   *
   * @example
   * ```typescript
   * await Snapshot.revert([
   *   { hash: "abc123", files: ["/path/to/file1", "/path/to/file2"] }
   * ])
   * ```
   */
  export async function revert(patches: Patch[]) {
    // 使用 Set 跟踪已处理的文件，避免重复
    const files = new Set<string>()
    const git = gitdir()

    // 遍历所有补丁
    for (const item of patches) {
      // 遍历补丁中的每个文件
      for (const file of item.files) {
        // 跳过已处理的文件
        if (files.has(file)) continue

        log.info("reverting", { file, hash: item.hash })

        // 从快照检出文件
        const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} checkout ${item.hash} -- ${file}`
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()

        // 处理检出失败
        if (result.exitCode !== 0) {
          // 获取相对路径
          const relativePath = path.relative(Instance.worktree, file)

          // 检查文件是否存在于快照
          const checkTree =
            await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${item.hash} -- ${relativePath}`
              .quiet()
              .cwd(Instance.worktree)
              .nothrow()

          if (checkTree.exitCode === 0 && checkTree.text().trim()) {
            // 文件存在于快照但检出失败，保留当前文件
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            // 文件不存在于快照，删除它
            log.info("file did not exist in snapshot, deleting", { file })
            await fs.unlink(file).catch(() => {})
          }
        }

        // 标记为已处理
        files.add(file)
      }
    }
  }

  /**
   * 获取与指定快照的差异文本
   *
   * 返回 git diff 的原始输出。
   *
   * @param hash - 快照的 tree hash
   * @returns Promise，解析为差异文本
   *
   * 如果 git diff 失败，返回空字符串。
   *
   * @example
   * ```typescript
   * const diff = await Snapshot.diff(snapshotHash)
   * console.log(diff)
   * ```
   */
  export async function diff(hash: string) {
    const git = gitdir()

    // 添加当前所有文件到暂存区
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()

    // 获取完整 diff
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    // 处理失败情况
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return ""
    }

    return result.text().trim()
  }

  /**
   * 文件差异类型 Schema
   *
   * 定义单个文件的完整差异信息。
   */
  export const FileDiff = z
    .object({
      // 文件路径（相对于工作树）
      file: z.string(),
      // 修改前的文件内容
      before: z.string(),
      // 修改后的文件内容
      after: z.string(),
      // 新增行数
      additions: z.number(),
      // 删除行数
      deletions: z.number(),
    })
    .meta({
      ref: "FileDiff",
    })

  /**
   * 文件差异类型
   *
   * 从 FileDiff Schema 推断的 TypeScript 类型。
   */
  export type FileDiff = z.infer<typeof FileDiff>

  /**
   * 获取两个快照间的完整差异
   *
   * 比较两个快照，返回每个文件的详细差异信息。
   *
   * @param from - 起始快照 hash
   * @param to - 结束快照 hash
   * @returns Promise，解析为文件差异数组
   *
   * 处理流程：
   * 1. 使用 --numstat 获取变更统计
   * 2. 解析每行的增删行数和文件名
   * 3. 使用 git show 获取修改前后的文件内容
   * 4. 二进制文件跳过内容，只记录 0 行
   *
   * 返回的每个元素包含：
   * - file：相对路径
   * - before/after：文件内容
   * - additions/deletions：行数统计
   *
   * @example
   * ```typescript
   * const diffs = await Snapshot.diffFull(fromHash, toHash)
   * for (const diff of diffs) {
   *   console.log(`${diff.file}: +${diff.additions} -${diff.deletions}`)
   * }
   * ```
   */
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    const result: FileDiff[] = []

    // 使用 --numstat 获取每个文件的增删行数
    for await (const line of $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue

      // 解析 numstat 输出：additions\tdeletions\tfile
      const [additions, deletions, file] = line.split("\t")

      // 检查是否为二进制文件（标记为 "-\t-"）
      const isBinaryFile = additions === "-" && deletions === "-"

      // 获取修改前的文件内容
      const before = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
            .quiet()
            .nothrow()
            .text()

      // 获取修改后的文件内容
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
            .quiet()
            .nothrow()
            .text()

      // 解析行数（二进制文件为 0）
      const added = isBinaryFile ? 0 : parseInt(additions)
      const deleted = isBinaryFile ? 0 : parseInt(deletions)

      result.push({
        file,
        before,
        after,
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
      })
    }

    return result
  }

  /**
   * 获取快照仓库目录路径
   *
   * @returns 快照仓库的绝对路径
   *
   * 路径格式：{data}/snapshot/{projectID}/
   */
  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}
