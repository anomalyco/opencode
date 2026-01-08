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
          ...skills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `  </skill>`,
          ]),
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
        const available = Skill.all().then((x) => Object.keys(x).join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })
      // Load and parse skill content
      const parsed = await ConfigMarkdown.parse(skill.location)
      const dir = path.dirname(skill.location)

      // Format output similar to plugin pattern
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
