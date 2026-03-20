import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Effect } from "effect"
import { Fff } from "../file/fff"
import { Glob } from "../util/glob"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

const Parameters = z.object({
  name: z.string().describe("The name of the skill from available_skills"),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* skill.get(params.name)
          if (!info) {
            const all = yield* skill.all()
            const available = all.map((item) => item.name).join(", ")
            throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
          }

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          const dir = path.dirname(info.location)
          const base = pathToFileURL(dir).href
          const limit = 10
          const files = yield* Effect.promise(async () => {
            ctx.abort.throwIfAborted()
            return (
              await Glob.scan("**/*", {
                cwd: dir,
                include: "file",
                dot: true,
              })
            )
              .map((file) => file.replaceAll("\\", "/"))
              .filter((file) => Fff.allowed({ rel: file, hidden: true, glob: ["!node_modules/*", "!.git/*"] }))
              .filter((file) => !file.includes("SKILL.md"))
              .slice(0, limit)
              .map((file) => `<file>${path.resolve(dir, file)}</file>`)
              .join("\n")
          })

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              info.content.trim(),
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files,
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
