import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { ConfigMarkdown } from "../config/markdown"

export const SkillTool = Tool.define("skill", async () => {
  const skills = await Skill.all()

  // Filter skills by agent permissions if agent provided
  /*
    let accessibleSkills = skills
    if (ctx?.agent) {
      const permissions = ctx.agent.permission.skill
      accessibleSkills = skills.filter((skill) => {
        const action = Wildcard.all(skill.name, permissions)
        return action !== "deny"
      })
    }
    */

  const description =
    skills.length === 0
      ? "Load a skill to get detailed instructions for a specific task. No skills are currently available."
      : [
          "Load a skill to get detailed instructions for a specific task.",
          "Skills provide specialized knowledge and step-by-step guidance.",
          "Use this when a task matches an available skill's description.",
          "<available_skills>",
          ...skills.flatMap((skill) => {
            const source = skill.remote ? ` (remote: ${skill.baseUrl})` : ""
            return [
              `  <skill>`,
              `    <name>${skill.name}</name>`,
              `    <description>${skill.description}${source}</description>`,
              `  </skill>`,
            ]
          }),
          "</available_skills>",
        ].join(" ")

  return {
    description,
    parameters: z.object({
      name: z
        .string()
        .describe("The skill identifier from available_skills (e.g., 'code-review' or 'category/helper')"),
    }),
    async execute(params, ctx) {
      const skill = await Skill.get(params.name)

      if (!skill) {
        const available = await Skill.all().then((x) => x.map((s) => s.name).join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })

      // Load skill content (handles both local and remote)
      const content = await Skill.getContent(params.name)
      if (!content) {
        throw new Error(`Failed to load content for skill "${params.name}"`)
      }

      // Parse the content to extract frontmatter
      const parsed = ConfigMarkdown.parseContent(content)
      const skillContent = parsed?.content?.trim() ?? content.trim()

      // For remote skills, use URL as base; for local, use directory
      const baseInfo = skill.remote
        ? `**Source**: ${skill.baseUrl}`
        : `**Base directory**: ${path.dirname(skill.location)}`

      const output = [`## Skill: ${skill.name}`, "", baseInfo, "", skillContent].join("\n")

      return {
        title: `Loaded skill: ${skill.name}`,
        output,
        metadata: {
          name: skill.name,
          remote: skill.remote ?? false,
          location: skill.location,
        },
      }
    },
  }
})
