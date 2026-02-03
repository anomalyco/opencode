import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { PermissionNext } from "../permission/next"
import { Session } from "../session"
import { Ripgrep } from "../file/ripgrep"
import { iife } from "@/util/iife"

export const SkillTool = Tool.define("skill", async (ctx) => {
  const skills = await Skill.all()

  // Filter skills by agent permissions if agent provided
  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : skills

  const description =
    accessibleSkills.length === 0
      ? "Load a skill to get detailed instructions for a specific task. No skills are currently available."
      : [
          "Load a skill to get detailed instructions for a specific task.",
          "Skills provide specialized knowledge and step-by-step guidance.",
          "Use this when a task matches an available skill's description.",
          "Only the skills listed here are available:",
          "<available_skills>",
          ...accessibleSkills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `  </skill>`,
          ]),
          "</available_skills>",
        ].join(" ")

  const examples = accessibleSkills
    .map((skill) => `'${skill.name}'`)
    .slice(0, 3)
    .join(", ")
  const hint = examples.length > 0 ? ` (e.g., ${examples}, ...)` : ""

  const parameters = z.object({
    name: z.string().describe(`The skill identifier from available_skills${hint}`),
  })

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const skill = await Skill.get(params.name)

      if (!skill) {
        const available = await Skill.all().then((x) => Object.keys(x).join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })

      const dir = path.dirname(skill.location)

      const limit = 10
      const files = await iife(async () => {
        const arr = []
        for await (const file of Ripgrep.files({
          cwd: dir,
          follow: false,
          hidden: true,
          signal: ctx.abort,
        })) {
          if (file.includes("SKILL.md")) {
            continue
          }
          arr.push(path.resolve(dir, file))
          if (arr.length >= limit) {
            break
          }
        }
        return arr
      }).then((f) => f.map((file) => `<file>${file}</file>`).join("\n"))

      await Session.update(ctx.sessionID, (draft) => {
        const ruleset = draft.permission ?? []
        const glob = path.join(dir, "*")
        if (!ruleset.some((r) => r.permission === "external_directory" && r.pattern === glob && r.action === "allow")) {
          ruleset.push({ permission: "external_directory", pattern: glob, action: "allow" })
        }
        draft.permission = ruleset
      })

      return {
        title: `Loaded skill: ${skill.name}`,
        output: [
          `<loaded_skill name="${skill.name}">`,
          `# ${skill.name} Skill`,
          "",
          skill.content.trim(),
          "",
          `Base directory for this skill: ${dir}`,
          "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
          `Skill files list is limited to ${limit} entries and may be incomplete.`,
          "",
          "<skill_files>",
          files,
          "</skill_files>",
          "</loaded_skill>",
        ].join("\n"),
        metadata: {
          name: skill.name,
          dir,
        },
      }
    },
  }
})
