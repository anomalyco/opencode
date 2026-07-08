export * as ConfigCommandPlugin from "./command"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import path from "path"
import { Effect, Option, Schema, Stream } from "effect"
import { CommandV2 } from "../../command"
import { Config } from "../../config"
import { FSUtil } from "../../fs-util"
import { ConfigCommand } from "../command"
import { ConfigMarkdown } from "../markdown"

const decodeCommand = Schema.decodeUnknownOption(ConfigCommand.Info)

export const Plugin = define({
  id: "opencode.config.command",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const load = Effect.fn("ConfigCommandPlugin.load")(function* () {
      return yield* Effect.forEach(yield* config.entries(), (entry) => {
        if (entry.type === "document") return Effect.succeed([{ commands: entry.info.commands }])
        if (entry.type !== "directory") return Effect.succeed([])
        return loadDirectory(fs, entry.path).pipe(
          Effect.map((commands) => [
            { commands: Object.fromEntries(commands.map((command) => [command.name, command.info])) },
          ]),
        )
      }).pipe(Effect.map((documents) => documents.flat()))
    })
    const loaded = { documents: yield* load() }
    yield* ctx.command.transform((draft) => {
      for (const document of loaded.documents) {
        for (const [name, command] of Object.entries(document.commands ?? {})) {
          draft.update(name, (item) => {
            item.template = command.template
            if (command.description !== undefined) item.description = command.description
            if (command.agent !== undefined) item.agent = command.agent
            if (command.model !== undefined)
              item.model = {
                id: command.model.model,
                providerID: command.model.providerID,
                ...(command.model.variant === undefined ? {} : { variant: command.model.variant }),
              }
            if (command.subtask !== undefined) item.subtask = command.subtask
          })
        }
      }
    })
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() =>
        load().pipe(
          Effect.tap((documents) => Effect.sync(() => (loaded.documents = documents))),
          Effect.andThen(ctx.command.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
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
