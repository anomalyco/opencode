export * as SkillTool from "./skill"

import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import path from "path"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import { FSUtil } from "../fs-util"
import { SkillV2 } from "../skill"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"

export const name = "skill"
const FILE_LIMIT = 10

export const Input = Schema.Struct({
  id: SkillV2.ID.annotate({ description: "The ID of the skill from the available skills list" }),
})

export const Output = Schema.Struct({
  name: SkillV2.Name,
  directory: Schema.String,
  output: Schema.String,
})

export const description = [
  "Load a specialized skill when the task at hand matches one of the available skills in the instructions.",
  "",
  "Use this tool to inject the skill's instructions and resources into the current conversation. The output may contain detailed workflow guidance as well as references to scripts, files, etc. in the same directory as the skill.",
  "",
  "The skill ID must match one of the available skills in the instructions.",
].join("\n")

export const toModelOutput = (skill: SkillV2.Info, files: ReadonlyArray<string>) => {
  const directory = path.dirname(skill.location)
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${directory}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    ...files.map((file) => `<file>${file}</file>`),
    "</skill_files>",
    "</skill_content>",
  ].join("\n")
}

const unableToLoad = (name: string, error?: unknown) =>
  new ToolFailure({ message: `Unable to load skill ${name}`, error })

export const Plugin = {
  id: "opencode.tool.skill",
  effect: Effect.fn("SkillTool.Plugin")(function* (ctx: PluginContext) {
    const fs = yield* FSUtil.Service
    const skills = yield* SkillV2.Service
    const permission = yield* PermissionV2.Service
    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.make({
            description,
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
            execute: (input, context) =>
              Effect.gen(function* () {
                const current = yield* skills.list()
                const skill = current.find((skill) => skill.id === input.id)
                if (!skill) return yield* unableToLoad(input.id)
                return yield* Effect.gen(function* () {
                  yield* permission.assert({
                    action: name,
                    resources: [skill.id],
                    save: [skill.id],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.messageID, callID: context.callID },
                  })
                  const directory = path.dirname(skill.location)
                  const files =
                    path.basename(skill.location) === "SKILL.md"
                      ? (yield* fs.glob("**/*", { cwd: directory, absolute: true, include: "file", dot: true }))
                          .filter((file) => path.basename(file) !== "SKILL.md")
                          .toSorted()
                          .slice(0, FILE_LIMIT)
                      : []
                  return {
                    name: skill.name,
                    directory,
                    output: toModelOutput(skill, files),
                  }
                }).pipe(Effect.mapError((error) => unableToLoad(input.id, error)))
              }),
          }),
          { codemode: false },
        ),
      )
      .pipe(Effect.orDie)
  }),
}
