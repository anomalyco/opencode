export * as ConfigCommandPlugin from "./command"

import { define } from "../../plugin/internal"
import path from "path"
import { Effect, Option, Schema } from "effect"
import { CommandV2 } from "../../command"
import { Config } from "../../config"
import { FSUtil } from "../../fs-util"
import { ModelV2 } from "../../model"
import { ConfigCommand } from "../command"
import { ConfigMarkdown } from "../markdown"

const decodeCommand = Schema.decodeUnknownOption(ConfigCommand.Info)

export const Plugin = define({
  id: "config-command",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    yield* ctx.command.transform(
      Effect.fn(function* (draft) {
        const documents = yield* Effect.forEach(yield* config.entries(), (entry) => {
          if (entry.type === "document") return Effect.succeed([{ commands: entry.info.commands }])
          return loadDirectory(fs, entry.path).pipe(
            Effect.map((commands) => [
              { commands: Object.fromEntries(commands.map((command) => [command.name, command.info])) },
            ]),
          )
        }).pipe(Effect.map((documents) => documents.flat()))
        for (const document of documents) {
          for (const [name, command] of Object.entries(document.commands ?? {})) {
            draft.update(name, (item) => {
              item.template = command.template
              if (command.description !== undefined) item.description = command.description
              if (command.agent !== undefined) item.agent = command.agent
              if (command.model !== undefined) {
                const model = ModelV2.parse(command.model)
                item.model = { id: model.modelID, providerID: model.providerID, variant: item.model?.variant }
              }
              if (command.variant !== undefined && item.model !== undefined) {
                item.model.variant = ModelV2.VariantID.make(command.variant)
              }
              if (command.subtask !== undefined) item.subtask = command.subtask
            })
          }
        }
      }),
    )
  }),
})

function loadDirectory(fs: FSUtil.Interface, directory: string) {
  return Effect.gen(function* () {
    const files = yield* fs
      .glob("{command,commands}/**/*.md", { cwd: directory, absolute: true, dot: true, symlink: true })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))
    return yield* Effect.forEach(files.toSorted(), (filepath) =>
      fs.readFileStringSafe(filepath).pipe(
        Effect.map((content) => (content === undefined ? undefined : decode(directory, filepath, content))),
        Effect.catch(() => Effect.succeed(undefined)),
      ),
    ).pipe(
      Effect.map((commands) =>
        commands.filter((command): command is { name: string; info: ConfigCommand.Info } => command !== undefined),
      ),
    )
  })
}

function decode(directory: string, filepath: string, content: string) {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return
  const info = Option.getOrUndefined(decodeCommand({ ...markdown.data, template: markdown.content.trim() }))
  if (!info) return
  return {
    name: path
      .relative(directory, filepath)
      .replaceAll("\\", "/")
      .replace(/^(command|commands)\//, "")
      .replace(/\.md$/, ""),
    info,
  }
}
