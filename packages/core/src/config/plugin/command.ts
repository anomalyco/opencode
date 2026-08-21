export * as ConfigCommandPlugin from "./command.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Info, type Entry } from "@opencode-ai/schema/config"
import { ConfigCommand } from "@opencode-ai/schema/config/command"
import path from "path"
import { Effect, Option, Schema, Stream } from "effect"
import { Command } from "../../command.js"
import { Config } from "../../config.js"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { ConfigMarkdown } from "../markdown.js"

const decodeCommand = Schema.decodeUnknownOption(ConfigCommand.Info)

export const Plugin = define({
  id: "opencode.config.command",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const loadEntry = Effect.fnUntraced(function* (entry: Entry) {
      if (entry.type === "document") return [{ commands: entry.info.commands }]
      if (entry.type !== "directory") return []
      const commands = yield* loadDirectory(fs, entry.path)
      return [{ commands: Object.fromEntries(commands.map((command) => [command.name, command.info])) }]
    })
    const load = Effect.fn("ConfigCommandPlugin.load")(function* () {
      return yield* Effect.forEach(yield* config.entries(), loadEntry).pipe(Effect.map((documents) => documents.flat()))
    })
    const loaded = { documents: [] as { commands: Info["commands"] }[] }
    const reload = load().pipe(
      Effect.tap((documents) => Effect.sync(() => (loaded.documents = documents))),
      Effect.andThen(ctx.command.reload()),
    )
    // One merged trigger stream serializes reloads and shares one debounce
    // window; subscribing before the initial scan means updates racing the
    // scan still trigger a rebuild.
    const sourceChanges = config
      .changes()
      .pipe(
        Stream.filterEffect((update) =>
          Effect.map(config.entries(), (entries) => isCommandSource(entries, update.path)),
        ),
      )
    const configUpdates = ctx.event.subscribe().pipe(Stream.filter((event) => event.type === "config.updated"))
    yield* Stream.merge(sourceChanges, configUpdates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.documents = yield* load()
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
  }),
})

// Keep in sync with the loadDirectory scan pattern and the name-strip regex in decode.
const sourceDirectories = ["command", "commands"] as const

// Matches anything at or under <root>/{command,commands}. No file-suffix check:
// directory-level events such as renames carry no per-file paths.
function isCommandSource(entries: Entry[], file: string) {
  return entries.some(
    (entry) =>
      entry.type === "directory" &&
      sourceDirectories.some((name) => FSUtil.contains(path.join(entry.path, name), file)),
  )
}

function loadDirectory(fs: FSUtil.Interface, directory: string) {
  return Effect.gen(function* () {
    const files = yield* fs
      .scan("{command,commands}/**/*.md", { cwd: directory, absolute: true, dot: true, symlink: true })
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
