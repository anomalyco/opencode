import path from "path"
import { pathToFileURL } from "url"
import { Cause, Effect, Schema } from "effect"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Skill } from "../skill"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Command } from "@/command"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const ReloadSkillsTool = Tool.define(
  "reload_skills",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const events = yield* EventV2Bridge.Service
    return {
      description:
        "Reload the list of available skills by rescanning configured skill directories. Call this after creating or modifying skill files to make them immediately available without restarting.",
      parameters: Schema.Struct({}),
      execute: (_params: {}, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const skills = yield* skill.refresh()
          yield* events.publish(Command.Event.CatalogUpdated, {}).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause)
                ? Effect.failCause(cause)
                : Effect.logWarning("failed to publish CatalogUpdated", { cause }),
            ),
          )
          const named = skills.filter((s) => s.description !== undefined)
          const names = named.map((s) => s.name).sort()
          return {
            title: `Skills reloaded: ${names.length} available`,
            output: `Skills reloaded successfully.\n\nAvailable skills (${names.length}):\n${names.map((n) => `- ${n}`).join("\n")}`,
            metadata: {},
          }
        }),
    }
  }),
)

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const ripgrep = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* skill
            .require(params.name)
            .pipe(Effect.catchTag("Skill.NotFoundError", (error) => Effect.die(new Error(error.message))))

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          const dir = path.dirname(info.location)
          const base = pathToFileURL(dir).href
          const files = yield* ripgrep.find({
            cwd: dir,
            pattern: "!**/SKILL.md",
            hidden: true,
            follow: false,
            signal: ctx.abort,
            limit: 10,
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
              files.map((file) => `<file>${path.resolve(dir, file.path)}</file>`).join("\n"),
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
