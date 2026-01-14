/**
 * ============================================================================
 * 文件名：skill.ts
 * 所属包：packages/opencode/src/skill
 * ============================================================================
 *
 * 文件作用：
 * Skill（技能）管理模块。扫描和管理项目中的自定义技能定义。
 *
 * 主要功能：
 * - state()：扫描并缓存所有可用的技能
 * - get(name)：获取指定名称的技能
 * - all()：获取所有可用技能列表
 *
 * 依赖关系：
 * - zod：类型验证
 * - @/config/config：配置管理
 * - @/project/instance：实例状态管理
 * - @opencode-ai/util/error：命名错误
 * - @/config/markdown：Markdown 配置解析
 * - @/util/log：日志
 * - @/global：全局配置
 * - @/util/filesystem：文件系统工具
 * - fs/promises：文件系统操作
 * - @/flag/flag：命令行标志位
 *
 * 导出内容：
 * - Skill namespace：Skill 管理命名空间
 *   - Info：技能信息 Zod schema
 *   - InvalidError：技能无效错误
 *   - NameMismatchError：技能名称不匹配错误
 *   - state：技能状态（响应式）
 *   - get(name)：获取指定技能
 *   - all()：获取所有技能
 *
 * 技能定义位置：
 * - OpenCode 格式：.opencode/skill\/**\/SKILL.md 或 .opencode/skills\/**\/SKILL.md
 * - Claude 格式：.claude/skills\/**\/SKILL.md
 * - 全局位置：~/.claude/skills\/**\/SKILL.md
 *
 * 技能 Markdown 格式：
 * ```markdown
 * # name
 *
 * 技能名称
 *
 * ## description
 *
 * 技能描述
 *
 * ## ... 其他部分
 * ```
 *
 * 扫描范围：
 * - 从项目目录向上查找 .claude 目录
 * - 所有配置目录（project、user、global）中的 .opencode 目录
 * - 全局 ~/.claude/skills/ 目录
 *
 * @package opencode
 * @module skill
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入配置管理
import { Config } from "../config/config"

// 导入实例状态管理
import { Instance } from "../project/instance"

// 导入命名错误工具
import { NamedError } from "@opencode-ai/util/error"

// 导入 Markdown 配置解析
import { ConfigMarkdown } from "../config/markdown"

// 导入日志
import { Log } from "../util/log"

// 导入全局配置
import { Global } from "@/global"

// 导入文件系统工具
import { Filesystem } from "@/util/filesystem"

// 导入文件系统 Promise API
import { exists } from "fs/promises"

// 导入命令行标志位
import { Flag } from "@/flag/flag"

/**
 * Skill 管理命名空间
 *
 * 包含所有技能相关的功能。
 */
export namespace Skill {
  // 创建技能服务日志记录器
  const log = Log.create({ service: "skill" })

  /**
   * 技能信息 Zod Schema
   *
   * 描述技能的基本信息。
   */
  export const Info = z.object({
    // 技能名称
    name: z.string(),
    // 技能描述
    description: z.string(),
    // 技能定义文件位置
    location: z.string(),
  })
  export type Info = z.infer<typeof Info>

  /**
   * 技能无效错误
   *
   * 当技能定义文件不符合要求时抛出。
   */
  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      // 文件路径
      path: z.string(),
      // 错误消息
      message: z.string().optional(),
      // Zod 验证问题列表
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  /**
   * 技能名称不匹配错误
   *
   * 当技能定义文件名与内容中的名称不匹配时抛出。
   */
  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      // 文件路径
      path: z.string(),
      // 期望的名称（从目录名）
      expected: z.string(),
      // 实际的名称（从文件内容）
      actual: z.string(),
    }),
  )

  /**
   * OpenCode 技能文件 Glob 模式
   *
   * 匹配 {skill,skills}/**/SKILL.md
   */
  const OPENCODE_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")

  /**
   * Claude 技能文件 Glob 模式
   *
   * 匹配 skills/**/SKILL.md
   */
  const CLAUDE_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")

  /**
   * 技能状态
   *
   * 使用 Instance.state() 创建响应式状态。
   * 扫描并缓存所有可用的技能。
   */
  export const state = Instance.state(async () => {
    // 技能映射：name -> Info
    const skills: Record<string, Info> = {}

    /**
     * 添加技能到映射
     *
     * @param match - 技能定义文件路径
     */
    const addSkill = async (match: string) => {
      // 解析 Markdown 文件
      const md = await ConfigMarkdown.parse(match)
      if (!md) {
        return
      }

      // 验证技能信息（只需 name 和 description）
      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) return

      // 检查重复的技能名称
      if (skills[parsed.data.name]) {
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      // 添加到技能映射
      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
      }
    }

    // 收集所有 .claude 目录（项目级别）
    const claudeDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".claude"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )

    // 包含全局 ~/.claude/skills/ 目录
    const globalClaude = `${Global.Path.home}/.claude`
    if (await exists(globalClaude)) {
      claudeDirs.push(globalClaude)
    }

    // 如果未禁用 Claude Code 技能，扫描 .claude 目录
    if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS) {
      for (const dir of claudeDirs) {
        const matches = await Array.fromAsync(
          CLAUDE_SKILL_GLOB.scan({
            cwd: dir,
            absolute: true,
            onlyFiles: true,
            followSymlinks: true,
            dot: true,
          }),
        ).catch((error) => {
          // 扫描失败时记录错误并返回空数组
          log.error("failed .claude directory scan for skills", { dir, error })
          return []
        })

        // 添加所有找到的技能
        for (const match of matches) {
          await addSkill(match)
        }
      }
    }

    // 扫描 .opencode/skill/ 目录
    for (const dir of await Config.directories()) {
      for await (const match of OPENCODE_SKILL_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    return skills
  })

  /**
   * 获取指定名称的技能
   *
   * @param name - 技能名称
   * @returns Promise，解析为技能信息，如果不存在返回 undefined
   */
  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  /**
   * 获取所有技能
   *
   * @returns Promise，解析为所有技能信息的列表
   */
  export async function all() {
    return state().then((x) => Object.values(x))
  }
}
