import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Effect } from "effect"
import { EffectLogger } from "@/effect/logger"
import * as Stream from "effect/Stream"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { Ripgrep } from "../file/ripgrep"

const Parameters = z.object({
  name: z.string().describe("The name of the skill from available_skills"),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const rg = yield* Ripgrep.Service

    return async () => {
      const list = await Effect.runPromise(skill.available().pipe(Effect.provide(EffectLogger.layer)))

      const description =
        list.length === 0
          ? "Load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
          : [
              "Load a specialized skill that provides domain-specific instructions and workflows.",
              "",
              "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
              "",
              "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
              "",
              'Tool output includes a `<skill_content name="...">` block with the loaded content.',
              "",
              "The following skills provide specialized sets of instructions for particular tasks",
              "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
              "",
              Skill.fmt(list, { verbose: false }),
            ].join("\n")

      return {
        description,
        parameters: Parameters,
        execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
          Effect.gen(function* () {
            const info = yield* skill.get(params.name)

            if (!info) {
              const all = yield* skill.all()
              const available = all.map((s) => s.name).join(", ")
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
            const files = yield* rg.files({ cwd: dir, follow: false, hidden: true }).pipe(
              Stream.filter((file) => !file.includes("SKILL.md")),
              Stream.map((file) => path.resolve(dir, file)),
              Stream.take(limit),
              Stream.runCollect,
              Effect.map((chunk) => [...chunk].map((file) => `<file>${file}</file>`).join("\n")),
            )

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
    }
  }),
)
