export * as ConfigCommandPlugin from "./command.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Info, type Entry } from "@opencode/schema/config"
import { ConfigCommand } from "@opencode/schema/config/command"
import { AppProcess } from "@opencode/util/process"
import path from "path"
import { Effect, Option, PubSub, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { Agent } from "../../agent.js"
import { Config } from "../../config.js"
import { Location } from "../../location.js"
import { Session } from "../../session.js"
import { SubagentJob } from "../../session/subagent-job.js"
import { ShellSelect } from "../../shell/select.js"
import { FSUtil } from "@opencode/util/fs-util"
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
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const shell = yield* ShellSelect.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const subagents = yield* SubagentJob.Service
    const load = Effect.fn("ConfigCommandPlugin.load")(function* () {
      return yield* Effect.forEach(yield* config.entries(), loadEntry).pipe(Effect.map((documents) => documents.flat()))
    })
    const loaded = { documents: [] as { commands: Info["commands"] }[] }
    const reload = load().pipe(
      Effect.tap((documents) => Effect.sync(() => (loaded.documents = documents))),
      Effect.andThen(ctx.command.reload()),
    )
    // One trigger feed serializes reloads and shares one debounce window;
    // subscribing before the initial scan means updates racing the scan still
    // trigger a rebuild. Each source is subscribed eagerly on its own fiber
    // (Stream.merge and Stream.debounce both open upstream a fiber hop later)
    // so no update slips through while the debounce starts its pull.
    const changes = yield* PubSub.sliding<void>(1)
    const notify = () => PubSub.publish(changes, undefined)
    yield* config.changes().pipe(
      Stream.filterEffect((update) => Effect.map(config.entries(), (entries) => isCommandSource(entries, update.path))),
      Stream.runForEach(notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* ctx.event
      .subscribe({ types: ["config.updated"] })
      .pipe(Stream.runForEach(notify), Effect.forkScoped({ startImmediately: true }))
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.documents = yield* load()
    yield* ctx.command.transform((editor) => {
      for (const document of loaded.documents) {
        for (const [name, command] of Object.entries(document.commands ?? {})) {
          const subagent = command.subagent ?? command.subtask
          const configuredAgent = command.agent === undefined ? undefined : Agent.ID.make(command.agent)
          editor.add({
            name,
            description: command.description,
            ...(configuredAgent === undefined ? {} : { agent: configuredAgent }),
            ...(subagent === undefined ? {} : { subagent }),
            template: command.template,
            execute: (input) =>
              Effect.gen(function* () {
                const agent = configuredAgent
                const commandAgent = agent === undefined ? undefined : (yield* ctx.agent.get({ agentID: agent })).data
                const explicitModel =
                  command.model === undefined
                    ? undefined
                    : {
                        id: command.model.model,
                        providerID: command.model.providerID,
                        ...(command.model.variant === undefined ? {} : { variant: command.model.variant }),
                      }
                const model = explicitModel ?? commandAgent?.model
                const text = yield* evaluateTemplate(command.template, input.prompt.text, {
                  location,
                  processes,
                  shell,
                  unattended: input.unattended,
                  note: input.note,
                })
                if ((subagent ?? commandAgent?.mode === "subagent") && !input.inline) {
                  const parent = yield* sessions.get(input.sessionID)
                  const selected = yield* agents.select(agent ?? parent.agent)
                  const parentSchedule = parent.metadata?.schedule
                  const scheduleMeta =
                    typeof parentSchedule === "object" && parentSchedule !== null && !Array.isArray(parentSchedule)
                      ? parentSchedule
                      : {}
                  const child = yield* sessions.create({
                    parentID: parent.id,
                    title: command.description ?? name,
                    agent: selected.id,
                    model: model ?? selected.info?.model ?? parent.model,
                    ...(input.unattended
                      ? {
                          permissions: parent.permissions,
                          metadata: {
                            ...parent.metadata,
                            schedule: { ...scheduleMeta, ownerSessionID: parent.id, unattended: true },
                          },
                        }
                      : {}),
                  })
                  yield* sessions.prompt({
                    ...input.prompt,
                    sessionID: child.id,
                    text: ["You are a subagent spawned by another session.", text].join("\n"),
                    resume: false,
                  })
                  const recovery = {
                    kind: "subagent" as const,
                    parentSessionID: parent.id,
                    childSessionID: child.id,
                    agent: selected.id,
                    description: command.description ?? name,
                  }
                  yield* subagents.start(recovery)
                  yield* subagents.background(recovery)
                  return
                }
                if (!input.inline && agent !== undefined) {
                  const session = yield* ctx.session.get({ sessionID: input.sessionID })
                  if (session.agent !== agent) yield* ctx.session.switchAgent({ sessionID: input.sessionID, agent })
                }
                const sessionModel = input.inline ? explicitModel : model
                if (sessionModel !== undefined)
                  yield* ctx.session.switchModel({ sessionID: input.sessionID, model: sessionModel })
                if (input.messageID !== undefined) {
                  yield* sessions.prompt({
                    ...input.prompt,
                    id: input.messageID,
                    sessionID: input.sessionID,
                    text,
                    delivery: input.delivery,
                    ...(input.inline ? { resume: false } : {}),
                  })
                  return
                }
                yield* ctx.session.prompt({
                  ...input.prompt,
                  sessionID: input.sessionID,
                  text,
                  delivery: input.delivery,
                })
              }).pipe(Effect.asVoid),
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
      .pipe(Effect.orElseSucceed(() => [] as string[]))
    return yield* Effect.forEach(files.toSorted(), (filepath) =>
      fs.readFileStringSafe(filepath).pipe(
        Effect.map((content) => (content === undefined ? undefined : decode(directory, filepath, content))),
        Effect.orElseSucceed(() => undefined),
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

export function unattendedShellSnippets(template: string, input: string, shell: string): string[] {
  const matches = Array.from(template.matchAll(shellRegex))
  if (matches.length === 0) return []
  const args = parseArguments(input)
  const last = maxPlaceholder(template)
  return matches.map((match) => substituteShellArguments(match[1] ?? "", input, args, last, shell))
}

function evaluateTemplate(
  template: string,
  input: string,
  services: {
    readonly location: Location.Info
    readonly processes: AppProcess.Interface
    readonly shell: ShellSelect.Interface
    readonly unattended?: boolean
    readonly note?: string
  },
) {
  return Effect.gen(function* () {
    if (!services.unattended) {
      const text = renderInteractiveArguments(template, input)
      const matches = Array.from(text.matchAll(shellRegex))
      if (matches.length === 0) return appendNote(text, services.note)
      const shell = yield* services.shell.resolve({ priority: "config" })
      const outputs = yield* runShellSnippets(
        matches.map((match) => match[1] ?? ""),
        shell,
        services,
      )
      const iterator = outputs[Symbol.iterator]()
      return appendNote(
        text.replace(shellRegex, () => iterator.next().value ?? ""),
        services.note,
      )
    }

    // Scheduled runs only execute `!`...`` blocks authored in `template`: `$1`/`$ARGUMENTS` inside those blocks are
    // shell-quoted for their quote context, snippet stdout is spliced in without running argument replacement over it,
    // and caller arguments / runtime check notes are never scanned for `!`...``.
    const args = parseArguments(input)
    const last = maxPlaceholder(template)
    const hasPlaceholder = last > 0 || template.includes("$ARGUMENTS")
    const matches = Array.from(template.matchAll(shellRegex))
    const outputs =
      matches.length === 0
        ? []
        : yield* Effect.gen(function* () {
            const shell = yield* services.shell.resolve({ priority: "compat" })
            const snippets = matches.map((match) => substituteShellArguments(match[1] ?? "", input, args, last, shell))
            return yield* runShellSnippets(snippets, shell, services)
          })

    let cursor = 0
    let combined = ""
    for (const [index, match] of matches.entries()) {
      const start = match.index ?? cursor
      combined += replaceArguments(template.slice(cursor, start), input, args, last)
      combined += outputs[index] ?? ""
      cursor = start + match[0].length
    }
    combined += replaceArguments(template.slice(cursor), input, args, last)
    const trimmed = combined.trim()
    const withInput = !hasPlaceholder && input.trim() ? `${trimmed}\n\n${input}`.trim() : trimmed
    return appendNote(withInput, services.note)
  })
}

function runShellSnippets(
  snippets: readonly string[],
  shell: string,
  services: {
    readonly location: Location.Info
    readonly processes: AppProcess.Interface
  },
) {
  return Effect.forEach(
    snippets,
    (source) =>
      services.processes
        .run(
          ChildProcess.make(shell, ShellSelect.args(shell, source), {
            cwd: services.location.directory,
            stdin: "ignore",
          }),
          { combineOutput: true },
        )
        .pipe(
          Effect.map((result) => (result.output ?? Buffer.concat([result.stdout, result.stderr])).toString("utf8")),
          Effect.mapError(
            (error) => new Error(`Shell interpolation failed for ${JSON.stringify(source)}: ${error.message}`),
          ),
        ),
    { concurrency: 2 },
  )
}

function maxPlaceholder(template: string) {
  const placeholders = template.match(placeholderRegex) ?? []
  return Math.max(0, ...placeholders.map((item) => Number(item.slice(1))))
}

function resolveArgument(
  match: string,
  index: string | undefined,
  input: string,
  args: readonly string[],
  last: number,
): string | undefined {
  if (match === "$ARGUMENTS") return input.length === 0 ? undefined : input
  const position = Number(index)
  const argIndex = position - 1
  if (argIndex >= args.length) return undefined
  if (position === last) return args.slice(argIndex).join(" ")
  return args[argIndex]
}

function replaceArguments(text: string, input: string, args: readonly string[], last: number) {
  return text.replaceAll(argumentRegex, (match, index) => resolveArgument(match, index, input, args, last) ?? "")
}

function renderInteractiveArguments(template: string, input: string) {
  const args = parseArguments(input)
  const last = maxPlaceholder(template)
  const withArguments = replaceArguments(template, input, args, last)
  return last === 0 && !template.includes("$ARGUMENTS") && input.trim()
    ? `${withArguments}\n\n${input}`.trim()
    : withArguments.trim()
}

function appendNote(text: string, note: string | undefined) {
  const trimmedNote = note?.trim()
  if (!trimmedNote) return text
  if (!text.trim()) return trimmedNote
  return `${text}\n\n${trimmedNote}`
}

type QuoteState = "none" | "single" | "double"

function substituteShellArguments(
  source: string,
  input: string,
  args: readonly string[],
  last: number,
  shell: string,
): string {
  const matches = Array.from(source.matchAll(argumentRegex))
  if (matches.length === 0) return source

  const kind: "cmd" | "ps" | "posix" =
    ShellSelect.name(shell) === "cmd" ? "cmd" : ShellSelect.ps(shell) ? "ps" : "posix"
  let quote: QuoteState = "none"
  let cursor = 0
  let result = ""

  for (const match of matches) {
    const start = match.index ?? cursor
    let i = cursor
    while (i < start) {
      const ch = source[i]
      if (kind === "cmd") {
        if (ch === '"') quote = quote === "double" ? "none" : "double"
      } else if (kind === "ps") {
        if (quote === "none") {
          if (ch === "`") i++
          else if (ch === "'") quote = "single"
          else if (ch === '"') quote = "double"
        } else if (quote === "single") {
          if (ch === "'" && source[i + 1] === "'") i++
          else if (ch === "'") quote = "none"
        } else {
          if (ch === "`") i++
          else if (ch === '"' && source[i + 1] === '"') i++
          else if (ch === '"') quote = "none"
        }
      } else {
        if (quote === "none") {
          if (ch === "\\") i++
          else if (ch === "'") quote = "single"
          else if (ch === '"') quote = "double"
        } else if (quote === "single") {
          if (ch === "'") quote = "none"
        } else {
          if (ch === "\\") i++
          else if (ch === '"') quote = "none"
        }
      }
      i++
    }

    result += source.slice(cursor, start)
    if (i > start) {
      result += match[0]
    } else {
      const value = resolveArgument(match[0], match[1], input, args, last)
      result += value === undefined ? "" : quoteShellValue(value, quote, kind)
    }
    cursor = start + match[0].length
  }

  result += source.slice(cursor)
  return result
}

function quoteShellValue(value: string, quote: QuoteState, kind: "cmd" | "ps" | "posix"): string {
  if (kind === "cmd") {
    const escaped = value.replace(/[\r\n]+/g, " ").replaceAll("%", "%%").replaceAll('"', '""')
    return quote === "double" ? escaped : `"${escaped}"`
  }
  if (kind === "ps") {
    if (quote === "double") {
      return value.replaceAll("`", "``").replaceAll('"', '`"').replaceAll("$", "`$")
    }
    const escaped = value.replaceAll("'", "''")
    return quote === "single" ? escaped : `'${escaped}'`
  }
  const escaped = value.replaceAll("'", "'\\''")
  if (quote === "single") return escaped
  if (quote === "double") return value === "" ? "" : `"'${escaped}'"`
  return `'${escaped}'`
}

function parseArguments(input: string) {
  return (input.match(argsRegex) ?? []).map((arg) => arg.replace(quoteTrimRegex, ""))
}

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$([1-9]\d*)/g
const argumentRegex = /\$(?:ARGUMENTS|([1-9]\d*))/g
const quoteTrimRegex = /^["']|["']$/g
const shellRegex = /!`([^`]+)`/g
