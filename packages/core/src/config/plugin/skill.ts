export * as ConfigSkillPlugin from "./skill"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { Config } from "../../config"
import { ConfigMarkdown } from "../markdown"
import { ConfigCommand } from "../command"
import { FSUtil } from "../../fs-util"
import { Global } from "../../global"
import { Location } from "../../location"
import { PluginV2 } from "../../plugin"
import { AbsolutePath } from "../../schema"
import { SkillV2 } from "../../skill"

export const Plugin = PluginV2.define({
  id: PluginV2.ID.make("config-skill"),
  effect: Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const skill = yield* SkillV2.Service
    const transform = yield* skill.transform()
    const entries = yield* config.entries()
    const items = entries.flatMap((entry) => (entry.type === "document" ? entry.info.skills ?? [] : []))
    const commands = new Map<string, SkillV2.Info>()
    for (const entry of entries) {
      if (entry.type !== "document") continue
      for (const [name, command] of Object.entries(entry.info.commands ?? {})) {
        commands.set(name, fromCommand(name, command, entry.path ? AbsolutePath.make(entry.path) : location.directory))
      }
    }
    for (const command of (
      yield* Effect.forEach(
        entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : [])),
        (directory) => loadCommands(fs, directory),
      )
    ).flat()) {
      commands.set(command.name, command)
    }

    yield* transform((editor) => {
      for (const command of commands.values()) editor.source(new SkillV2.SkillSource({ type: "skill", skill: command }))
      for (const item of items) {
        if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) {
          editor.source(new SkillV2.UrlSource({ type: "url", url: item }))
          continue
        }
        const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
        editor.source(
          new SkillV2.DirectorySource({
            type: "directory",
            path: AbsolutePath.make(path.isAbsolute(expanded) ? expanded : path.join(location.directory, expanded)),
          }),
        )
      }
    })
  }),
})

const decodeCommand = Schema.decodeUnknownOption(ConfigCommand.Info)

function loadCommands(fs: FSUtil.Interface, directory: string) {
  return Effect.gen(function* () {
    const files = yield* fs
      .glob("{command,commands}/**/*.md", { cwd: directory, absolute: true, dot: true, symlink: true })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))
    return yield* Effect.forEach(files.toSorted(), (filepath) =>
      fs.readFileStringSafe(filepath).pipe(
        Effect.map((content) => content && command(directory, filepath, content)),
        Effect.catch(() => Effect.succeed(undefined)),
      ),
    ).pipe(Effect.map((commands) => commands.filter((command): command is SkillV2.Info => command !== undefined)))
  })
}

function command(directory: string, filepath: string, content: string) {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return
  const info = decodeCommand({ ...markdown.data, template: markdown.content.trim() }).valueOrUndefined
  if (!info) return
  return fromCommand(
    path
      .relative(directory, filepath)
      .replaceAll("\\", "/")
      .replace(/^(command|commands)\//, "")
      .replace(/\.md$/, ""),
    info,
    AbsolutePath.make(filepath),
  )
}

function fromCommand(name: string, command: ConfigCommand.Info, location: AbsolutePath) {
  return new SkillV2.Info({
    name,
    description: command.description,
    slash: true,
    subagent: command.subtask,
    agent: command.agent,
    model: command.model,
    location,
    content: command.template,
  })
}
