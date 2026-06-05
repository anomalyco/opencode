export * as SkillTool from "./skill"

import path from "path"
import { pathToFileURL } from "url"
import { Tool, ToolFailure, toolText } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { FSUtil } from "../fs-util"
import { PluginBoot } from "../plugin/boot"
import { SkillV2 } from "../skill"
import { ToolOutputStore } from "../tool-output-store"
import { ToolRegistry } from "./registry"

export const name = "skill"
const FILE_LIMIT = 10

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from the available skills list" }),
})

export const Success = Schema.Struct({
  name: Schema.String,
  directory: Schema.String,
  output: Schema.String,
  truncated: Schema.Boolean,
  outputPath: Schema.String.pipe(Schema.optional),
})

export const description = [
  "Load a specialized skill when the task at hand matches one of the available skills in the system context.",
  "",
  "Use this tool to inject the skill's instructions and resources into the current conversation. The output may contain detailed workflow guidance as well as references to scripts, files, etc. in the same directory as the skill.",
  "",
  "The skill name must match one of the available skills in the system context.",
].join("\n")

export const toModelOutput = (skill: SkillV2.Info, files: ReadonlyArray<string>) => {
  const directory = path.dirname(skill.location)
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${pathToFileURL(directory).href}`,
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

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const fs = yield* FSUtil.Service
    const boot = yield* PluginBoot.Service
    const skills = yield* SkillV2.Service
    const resources = yield* ToolOutputStore.Service
    yield* boot.wait()
    const definition = Tool.make({
      description,
      parameters: Parameters,
      success: Success,
      toModelOutput: ({ output }) => [toolText({ type: "text", text: output.output })],
    })

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        outputPaths: (output) => (output.outputPath ? [output.outputPath] : []),
        execute: ({ parameters, sessionID, call, assertPermission }) =>
          Effect.gen(function* () {
            const current = yield* skills.list()
            const skill = current.find((skill) => skill.name === parameters.name)
            if (!skill) return yield* unableToLoad(parameters.name)
            return yield* Effect.gen(function* () {
              yield* assertPermission({ action: name, resources: [skill.name], save: [skill.name] })
              const directory = path.dirname(skill.location)
              const files =
                path.basename(skill.location) === "SKILL.md"
                  ? (yield* fs.glob("**/*", { cwd: directory, absolute: true, include: "file", dot: true }))
                      .filter((file) => path.basename(file) !== "SKILL.md")
                      .toSorted()
                      .slice(0, FILE_LIMIT)
                  : []
              const output = yield* resources.truncate({
                sessionID,
                toolCallID: call.id,
                content: toModelOutput(skill, files),
              })
              return {
                name: skill.name,
                directory,
                output: output.content,
                truncated: output.truncated,
                ...(output.truncated ? { outputPath: output.outputPath } : {}),
              }
            }).pipe(Effect.catchCause((cause) => Effect.fail(unableToLoad(parameters.name, Cause.squash(cause)))))
          }),
      }),
    )
  }),
)
