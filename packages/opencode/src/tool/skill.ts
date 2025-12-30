import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { Agent } from "../agent/agent"
import { Permission } from "../permission"
import { Wildcard } from "../util/wildcard"
import { ConfigMarkdown } from "../config/markdown"
import { Config } from "../config/config"

const parameters = z.object({
  name: z.string().describe("The skill identifier from available_skills (e.g., 'code-review')"),
})

export const SkillTool: Tool.Info<typeof parameters> = {
  id: "skill",
  async init(ctx) {
    const skills = await Skill.all()

    const { accessibleSkills, permissionMap } = ctx?.agent
      ? skills.reduce(
          (acc, skill) => {
            const action = Wildcard.all(skill.name, ctx.agent!.permission.skill)
            acc.permissionMap.set(skill.name, action)
            if (action !== "deny") {
              acc.accessibleSkills.push(skill)
            }
            return acc
          },
          {
            accessibleSkills: [] as typeof skills,
            permissionMap: new Map<string, typeof Config.Permission[keyof typeof Config.Permission]>(),
          },
        )
      : { accessibleSkills: skills, permissionMap: null }

    const description =
      accessibleSkills.length === 0
        ? "Load a skill to get detailed instructions for a specific task. No skills are currently available."
        : [
            "Load a skill to get detailed instructions for a specific task.",
            "Skills provide specialized knowledge and step-by-step guidance.",
            "Use this when a task matches an available skill's description.",
            "<available_skills>",
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
      async execute(params, ctx) {
        const skill = await Skill.get(params.name)

        if (!skill) {
          const available = accessibleSkills.map((s) => s.name).join(", ")
          throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
        }

        const action = permissionMap?.get(params.name)

        if (action === "deny") {
          const agent = await Agent.get(ctx.agent)
          throw new Permission.RejectedError(
            ctx.sessionID,
            "skill",
            ctx.callID,
            { skill: params.name },
            `Access to skill "${params.name}" is denied for agent "${agent.name}".`,
          )
        }

        if (action === "ask") {
          await Permission.ask({
            type: "skill",
            pattern: params.name,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            callID: ctx.callID,
            title: `Load skill: ${skill.name}`,
            metadata: { name: skill.name, description: skill.description },
          })
        }

        // Load and parse skill content
        const parsed = await ConfigMarkdown.parse(skill.location)
        const dir = path.dirname(skill.location)

        // Format output similar to plugin pattern
        const output = [`## Skill: ${skill.name}`, "", `**Base directory**: ${dir}`, "", parsed.content.trim()].join(
          "\n",
        )

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
  },
}
