/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/worktree
 * ============================================================================
 *
 * 文件作用：
 * Git Worktree 管理模块。为 Git 项目创建独立的工作树（worktree），允许同时在不同分支上工作。
 *
 * 主要功能：
 * - create()：创建新的 Git worktree
 * - 随机生成 worktree 名称（形容词-名词组合）
 * - 支持 Git worktree 创建和分支管理
 * - 支持创建后执行启动命令
 * - 验证 Git 项目和分支冲突
 *
 * 依赖关系：
 * - bun：Bun shell ($)
 * - fs/promises：文件系统操作
 * - path：路径处理
 * - zod：类型验证
 * - @opencode-ai/util/error：命名错误
 * - @/global：全局配置
 * - @/project/instance：实例状态管理
 * - @/project/project：项目管理
 * - @/util/fn：函数工具
 * - @/config/config：配置管理
 *
 * 导出内容：
 * - Worktree namespace：Worktree 管理命名空间
 *   - Info：Worktree 信息 Zod schema
 *   - CreateInput：创建输入 Zod schema
 *   - NotGitError：非 Git 项目错误
 *   - NameGenerationFailedError：名称生成失败错误
 *   - CreateFailedError：创建失败错误
 *   - StartCommandFailedError：启动命令失败错误
 *   - create(input)：创建 worktree
 *
 * 命名规则：
 * - 默认：随机名称（形容词-名词，如 "brave-panda"）
 * - 自定义：使用 slug 格式化用户提供的名称
 * - 分支名：opencode/{worktree-name}
 *
 * @package opencode
 * @module worktree
 */

// 导入 Bun shell，用于执行命令
import { $ } from "bun"

// 导入文件系统 Promise API
import fs from "fs/promises"

// 导入路径处理模块
import path from "path"

// 导入 Zod 类型验证库
import z from "zod"

// 导入命名错误工具
import { NamedError } from "@opencode-ai/util/error"

// 导入全局配置
import { Global } from "../global"

// 导入实例状态管理
import { Instance } from "../project/instance"

// 导入项目管理
import { Project } from "../project/project"

// 导入函数工具
import { fn } from "../util/fn"

// 导入配置管理
import { Config } from "@/config/config"

/**
 * Worktree 管理命名空间
 *
 * 包含所有 Git worktree 相关的功能。
 */
export namespace Worktree {
  /**
   * Worktree 信息 Zod Schema
   *
   * 描述 worktree 的基本信息。
   */
  export const Info = z
    .object({
      // Worktree 名称
      name: z.string(),
      // 关联的分支名
      branch: z.string(),
      // Worktree 目录路径
      directory: z.string(),
    })
    .meta({
      ref: "Worktree",
    })

  export type Info = z.infer<typeof Info>

  /**
   * 创建 Worktree 输入 Zod Schema
   *
   * 验证创建 worktree 的输入参数。
   */
  export const CreateInput = z
    .object({
      // Worktree 名称（可选，默认随机生成）
      name: z.string().optional(),
      // 启动命令（可选，在 worktree 创建后执行）
      startCommand: z.string().optional(),
    })
    .meta({
      ref: "WorktreeCreateInput",
    })

  export type CreateInput = z.infer<typeof CreateInput>

  /**
   * 非 Git 项目错误
   *
   * 当项目不是 Git 项目时抛出。
   */
  export const NotGitError = NamedError.create(
    "WorktreeNotGitError",
    z.object({
      // 错误消息
      message: z.string(),
    }),
  )

  /**
   * 名称生成失败错误
   *
   * 当无法生成唯一的 worktree 名称时抛出。
   */
  export const NameGenerationFailedError = NamedError.create(
    "WorktreeNameGenerationFailedError",
    z.object({
      // 错误消息
      message: z.string(),
    }),
  )

  /**
   * 创建失败错误
   *
   * 当 git worktree add 命令失败时抛出。
   */
  export const CreateFailedError = NamedError.create(
    "WorktreeCreateFailedError",
    z.object({
      // 错误消息
      message: z.string(),
    }),
  )

  /**
   * 启动命令失败错误
   *
   * 当启动命令执行失败时抛出。
   */
  export const StartCommandFailedError = NamedError.create(
    "WorktreeStartCommandFailedError",
    z.object({
      // 错误消息
      message: z.string(),
    }),
  )

  /**
   * 形容词列表
   *
   * 用于随机生成 worktree 名称。
   * 选择积极、友好的形容词。
   */
  const ADJECTIVES = [
    "brave",     // 勇敢的
    "calm",      // 冷静的
    "clever",    // 聪明的
    "cosmic",    // 宇宙的
    "crisp",     // 清新的
    "curious",   // 好奇的
    "eager",     // 渴望的
    "gentle",    // 温柔的
    "glowing",   // 发光的
    "happy",     // 快乐的
    "hidden",    // 隐藏的
    "jolly",     // 欢乐的
    "kind",      // 善良的
    "lucky",     // 幸运的
    "mighty",    // 强大的
    "misty",     // 薄雾的
    "neon",      // 霓虹的
    "nimble",    // 敏捷的
    "playful",   // 顽皮的
    "proud",     // 骄傲的
    "quick",     // 快速的
    "quiet",     // 安静的
    "shiny",     // 闪亮的
    "silent",    // 沉默的
    "stellar",   // 星际的
    "sunny",     // 阳光的
    "swift",     // 迅速的
    "tidy",      // 整洁的
    "witty",     // 诙谐的
  ] as const

  /**
   * 名词列表
   *
   * 用于随机生成 worktree 名称。
   * 选择自然、动物、科技相关的名词。
   */
  const NOUNS = [
    "cabin",     // 小屋
    "cactus",    // 仙人掌
    "canyon",    // 峡谷
    "circuit",   // 电路
    "comet",     // 彗星
    "eagle",     // 鹰
    "engine",    // 引擎
    "falcon",    // 隼
    "forest",    // 森林
    "garden",    // 花园
    "harbor",    // 港口
    "island",    // 岛屿
    "knight",    // 骑士
    "lagoon",    // 泻湖
    "meadow",    // 草地
    "moon",      // 月亮
    "mountain",  // 山脉
    "nebula",    // 星云
    "orchid",    // 兰花
    "otter",     // 水獭
    "panda",     // 熊猫
    "pixel",     // 像素
    "planet",    // 行星
    "river",     // 河流
    "rocket",    // 火箭
    "sailor",    // 水手
    "squid",     // 鱿鱼
    "star",      // 星星
    "tiger",     // 老虎
    "wizard",    // 巫师
    "wolf",      // 狼
  ] as const

  /**
   * 从列表中随机选择一个元素
   *
   * @param list - 字符串列表
   * @returns 随机选择的元素
   */
  function pick<const T extends readonly string[]>(list: T) {
    // 生成随机索引并返回对应元素
    return list[Math.floor(Math.random() * list.length)]
  }

  /**
   * 将输入字符串转换为 slug 格式
   *
   * 转换规则：
   * - 去除首尾空格
   * - 转换为小写
   * - 非字母数字字符替换为连字符
   * - 去除首尾连字符
   *
   * @param input - 输入字符串
   * @returns 格式化后的 slug
   */
  function slug(input: string) {
    return input
      .trim()                     // 去除首尾空格
      .toLowerCase()              // 转换为小写
      .replace(/[^a-z0-9]+/g, "-")  // 非字母数字替换为连字符
      .replace(/^-+/, "")         // 去除开头连字符
      .replace(/-+$/, "")         // 去除结尾连字符
  }

  /**
   * 生成随机名称
   *
   * 组合随机形容词和名词，格式：{adjective}-{noun}
   * 例如：brave-panda, stellar-wizard
   *
   * @returns 随机生成的名称
   */
  function randomName() {
    return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
  }

  /**
   * 检查路径是否存在
   *
   * @param target - 目标路径
   * @returns Promise，路径存在返回 true，否则返回 false
   */
  async function exists(target: string) {
    return fs
      .stat(target)   // 尝试获取文件状态
      .then(() => true)   // 成功表示路径存在
      .catch(() => false) // 失败表示路径不存在
  }

  /**
   * 将字节数组解码为文本
   *
   * @param input - 字节数组
   * @returns 解码后的文本，如果输入为空返回空字符串
   */
  function outputText(input: Uint8Array | undefined) {
    // 如果输入为空或长度为 0，返回空字符串
    if (!input?.length) return ""
    // 使用 UTF-8 解码并去除首尾空格
    return new TextDecoder().decode(input).trim()
  }

  /**
   * 从命令执行结果中提取错误信息
   *
   * 优先使用 stderr，其次使用 stdout。
   *
   * @param result - 命令执行结果
   * @returns 合并的错误文本
   */
  function errorText(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [
      outputText(result.stderr),  // 优先使用标准错误输出
      outputText(result.stdout)   // 其次使用标准输出
    ]
      .filter(Boolean)  // 过滤掉空字符串
      .join("\n")       // 用换行符连接
  }

  /**
   * 生成候选 worktree 信息
   *
   * 尝试生成一个唯一的 worktree 名称和对应的目录、分支。
   * 最多尝试 26 次。
   *
   * @param root - Worktree 根目录
   * @param base - 基础名称（可选）
   * @returns Promise，解析为 worktree 信息
   * @throws {NameGenerationFailedError} 无法生成唯一名称时
   *
   * 尝试策略：
   * 1. 如果提供了 base，第一次尝试使用 base
   * 2. 后续尝试使用 base-{random} 格式
   * 3. 如果没有 base，直接使用随机名称
   * 4. 检查目录是否已存在
   * 5. 检查分支是否已存在
   * 6. 最多尝试 26 次
   */
  async function candidate(root: string, base?: string) {
    // 最多尝试 26 次
    for (const attempt of Array.from({ length: 26 }, (_, i) => i)) {
      // 生成名称：如果有 base，第一次用 base，后续用 base-{random}
      // 如果没有 base，直接用随机名称
      const name = base ? (attempt === 0 ? base : `${base}-${randomName()}`) : randomName()

      // 分支名格式：opencode/{name}
      const branch = `opencode/${name}`

      // worktree 目录路径
      const directory = path.join(root, name)

      // 如果目录已存在，继续下一次尝试
      if (await exists(directory)) continue

      // 检查分支是否已存在
      const ref = `refs/heads/${branch}`
      const branchCheck = await $`git show-ref --verify --quiet ${ref}`.quiet().nothrow().cwd(Instance.worktree)

      // 如果分支已存在，继续下一次尝试
      if (branchCheck.exitCode === 0) continue

      // 找到可用的名称，返回 worktree 信息
      return Info.parse({ name, branch, directory })
    }

    // 尝试 26 次后仍无法生成唯一名称，抛出错误
    throw new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
  }

  /**
   * 在 worktree 目录中执行启动命令
   *
   * 根据平台选择不同的 shell 执行命令。
   *
   * @param directory - Worktree 目录
   * @param cmd - 要执行的命令
   * @returns Promise，解析为命令执行结果
   *
   * 平台差异：
   * - win32：使用 cmd /c
   * - 其他：使用 bash -lc（登录 shell）
   */
  async function runStartCommand(directory: string, cmd: string) {
    // Windows 平台：使用 cmd
    if (process.platform === "win32") {
      return $`cmd /c ${cmd}`.nothrow().cwd(directory)
    }

    // Unix 平台：使用 bash -lc（登录 shell，加载环境配置）
    return $`bash -lc ${cmd}`.nothrow().cwd(directory)
  }

  /**
   * 创建 Git Worktree
   *
   * 创建一个新的 Git worktree，并可选地执行启动命令。
   *
   * @param input - 创建参数（可选）
   *   - name：worktree 名称（可选，默认随机生成）
   *   - startCommand：启动命令（可选）
   * @returns Promise，解析为 worktree 信息
   * @throws {NotGitError} 项目不是 Git 项目
   * @throws {CreateFailedError} worktree 创建失败
   * @throws {StartCommandFailedError} 启动命令执行失败
   *
   * 流程：
   * 1. 验证项目是 Git 项目
   * 2. 创建 worktree 根目录
   * 3. 生成唯一的 worktree 名称
   * 4. 执行 git worktree add 创建 worktree
   * 5. 如果指定了启动命令，执行它
   */
  export const create = fn(CreateInput.optional(), async (input) => {
    // 检查项目版本控制系统是否为 Git
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    // 构建 worktree 根目录：{data}/worktree/{project-id}
    const root = path.join(Global.Path.data, "worktree", Instance.project.id)

    // 递归创建 worktree 根目录
    await fs.mkdir(root, { recursive: true })

    // 处理用户提供的名称：转换为 slug 格式，如果为空则使用 undefined
    const base = input?.name ? slug(input.name) : ""

    // 生成唯一的 worktree 信息（名称、分支、目录）
    const info = await candidate(root, base || undefined)

    // 执行 git worktree add 命令创建 worktree
    // -b：创建并切换到新分支
    const created = await $`git worktree add -b ${info.branch} ${info.directory}`
      .quiet()      // 安静模式，不输出命令
      .nothrow()    // 不抛出异常，通过 exitCode 检查
      .cwd(Instance.worktree)  // 在原 worktree 中执行

    // 如果创建失败，抛出错误
    if (created.exitCode !== 0) {
      throw new CreateFailedError({ message: errorText(created) || "Failed to create git worktree" })
    }

    // 获取并清理启动命令
    const cmd = input?.startCommand?.trim()

    // 如果没有启动命令，直接返回 worktree 信息
    if (!cmd) return info

    // 在新 worktree 目录中执行启动命令
    const ran = await runStartCommand(info.directory, cmd)

    // 如果启动命令失败，抛出错误
    if (ran.exitCode !== 0) {
      throw new StartCommandFailedError({ message: errorText(ran) || "Worktree start command failed" })
    }

    // 返回 worktree 信息
    return info
  })
}
