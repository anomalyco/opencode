import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { Agent } from "../agent/agent"
import { Permission } from "../permission"
import { Wildcard } from "../util/wildcard"
import { ConfigMarkdown } from "../config/markdown"

const parameters = z.object({
  name: z.string().describe("The skill identifier from available_skills (e.g., 'code-review')"),
})

export const SkillTool: Tool.Info<typeof parameters> = {
  id: "skill",
  async init(ctx) {
    const skills = await Skill.all()

    // Filter skills by agent permissions if agent provided
    let accessibleSkills = skills
    if (ctx?.agent) {
      const permissions = ctx.agent.permission.skill
      accessibleSkills = skills.filter((skill) => {
        const action = Wildcard.all(skill.name, permissions)
        return action !== "deny"
      })
    }

    return {
      description: [
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
      ].join(" "),
      parameters,
      async execute(params, ctx) {
        const agent = await Agent.get(ctx.agent)

        const skill = await Skill.get(params.name)

        if (!skill) {
          const available = await Skill.all().then((x) => x.map((s) => s.name).join(", "))
          throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
        }

        // Check permission using Wildcard.all on the skill name
        const permissions = agent.permission.skill
        const action = Wildcard.all(params.name, permissions)

        if (action === "deny") {
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
