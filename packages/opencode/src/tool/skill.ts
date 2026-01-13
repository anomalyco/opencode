/**
 * ============================================================================
 * 文件名：skill.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Skill 工具模块。允许 AI 加载技能（预定义的任务指导）。
 *
 * 主要功能：
 * - SkillTool：加载技能的工具
 * - 根据权限过滤可用技能
 * - 解析技能文件内容
 *
 * 依赖关系：
 * - path：路径处理
 * - zod：类型验证
 * - ./tool：工具基类
 * - ../skill：技能管理
 * - ../config/markdown：Markdown 解析
 * - ../permission/next：权限评估
 *
 * 导出内容：
 * - SkillTool：技能工具定义
 *
 * 参数：
 * - name：技能标识符（如 "code-review" 或 "category/helper"）
 *
 * 返回：
 * - title：技能名称标题
 * - output：格式化的技能内容
 * - metadata：技能元数据（名称、目录）
 *
 * 工具描述：
 * - 动态生成，包含所有可用技能列表
 * - 根据权限过滤技能
 * - 使用 XML 格式展示技能信息
 *
 * 使用场景：
 * - AI 需要特定任务的详细指导时
 * - 遵循预定义的工作流程
 * - 获取专业知识
 *
 * @package opencode
 * @module tool/skill
 */

// 导入路径处理
import path from "path"

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入技能管理
import { Skill } from "../skill"

// 导入 Markdown 解析
import { ConfigMarkdown } from "../config/markdown"

// 导入权限评估
import { PermissionNext } from "../permission/next"

/**
 * 参数 Schema
 *
 * 定义加载技能所需的参数。
 */
const parameters = z.object({
  // 技能标识符
  name: z.string().describe("The skill identifier from available_skills (e.g., 'code-review' or 'category/helper')"),
})

/**
 * 技能工具定义
 *
 * 允许 AI 加载技能以获取特定任务的详细指导。
 */
export const SkillTool = Tool.define("skill", async (ctx) => {
  // 获取所有技能
  const skills = await Skill.all()

  // 根据权限过滤技能
  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        // 评估技能的访问权限
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : skills

  // 生成工具描述
  const description =
    accessibleSkills.length === 0
      ? "Load a skill to get detailed instructions for a specific task. No skills are currently available."
      : [
          "Load a skill to get detailed instructions for a specific task.",
          "Skills provide specialized knowledge and step-by-step guidance.",
          "Use this when a task matches an available skill's description.",
          "<available_skills>",
          // 格式化每个技能为 XML
          ...accessibleSkills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `  </skill>`,
          ]),
          "</available_skills>",
        ].join(" ")

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      // 获取技能
      const skill = await Skill.get(params.name)

      // 技能不存在
      if (!skill) {
        const available = await Skill.all().then((x) => Object.keys(x).join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }

      // 请求技能访问权限
      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })

      // 加载并解析技能内容
      const parsed = await ConfigMarkdown.parse(skill.location)
      const dir = path.dirname(skill.location)

      // 格式化输出（类似插件模式）
      const output = [`## Skill: ${skill.name}`, "", `**Base directory**: ${dir}`, "", parsed.content.trim()].join("\n")

      return {
        title: `Loaded skill: ${skill.name}`,
        output,
        metadata: {
          name: skill.name,
          dir,
        },
      }
    },
  }
})
