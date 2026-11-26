export * as CodeModeToolsPlugin from "./codemode-tools.js"

import { ToolFailure } from "@opencode/ai/effect"
import { toolExpression, type CodeMode } from "@opencode/codemode"
import type { Context as PluginContext } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Context, Effect, Result, Schema, Semaphore } from "effect"
import path from "path"
import { Agent } from "../../agent.js"
import { CodeModeAgents } from "../../codemode/agents.js"
import { CodeModeApi } from "../../codemode/api.js"
import { CodeModeCustomTool } from "../../codemode/custom-tool.js"
import { CodeModeTool } from "../../codemode/tool.js"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { FileAccess } from "../../file-access.js"
import { Flag } from "../../flag.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { Tool } from "../../tool.js"
import { toolFailure } from "../runtime.js"

const Scope = Schema.Literals(["project", "user"])
type Scope = typeof Scope.Type
const OriginScope = Schema.Literals(["project", "user", "config"])
type OriginScope = typeof OriginScope.Type
const Extension = Schema.Literals(["fetch", "path", "bun", "agents"])

export const CreateInput = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      'Tool name, e.g. "triage_prs" or dotted "github.triage_prs". Registered as tools.custom.<name>. Use only letters, digits, underscores, and hyphens.',
  }),
  description: Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      "One sentence shown to every later session, which decides from it alone whether to call the tool: say what question it answers, which files or paths it reads, and what it leaves out.",
  }),
  code: Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      "Plain JavaScript program body (no code fence, no imports), ending in `return <result>`. Globals: `args` (the validated input), `tools.<path>(...)` (written out statically), `fetch`, `Bun.file`, `Bun.write`, `Bun.Glob`, `path`. There is no `process`, `require` of Node modules or timers. Relative paths resolve against the project directory, so use them as they are. If the code has backslashes (regexes), pass it with String.raw.",
  }),
  input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)).annotate({
    description:
      'Optional JSON Schema object describing `args` (object root). Defaults to an empty object schema (`{ type: "object", properties: {}, additionalProperties: false }`).',
  }),
  output: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)).annotate({
    description:
      "JSON Schema of the script's return value. Recommended: later sessions see it as the tool's return type, and results are checked against it.",
  }),
  test: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)).annotate({
    description:
      "Arguments to run the saved tool with once, right away. Its return value comes back as `result`, so one call saves the tool, proves it works and gives you the answer.",
  }),
  scope: Schema.optionalKey(Scope).annotate({
    description:
      'Where to save the .js file: "project" (.opencode/tools/<name>.js, default) or "user" (~/.config/opencode/tools/<name>.js).',
  }),
})

const CreateOutput = Schema.Struct({
  name: Schema.String,
  tool: Schema.String,
  scope: Scope,
  filepath: Schema.String,
  created: Schema.Boolean,
  /** How to call it. */
  usage: Schema.String,
  /** What the tool returned for `test`. */
  result: Schema.optionalKey(Schema.Json),
  note: Schema.String,
})

const NameInput = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'Custom tool name (e.g. "triage_prs" or "custom.triage_prs").',
  }),
})

const DeleteInput = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'Custom tool name (e.g. "triage_prs" or "custom.triage_prs").',
  }),
  scope: Schema.optionalKey(Scope).annotate({
    description: 'Optional scope to delete from ("project" or "user"). Defaults to the active loaded tool.',
  }),
})

const DeleteOutput = Schema.Struct({
  name: Schema.String,
  tool: Schema.String,
  filepath: Schema.String,
  removed: Schema.Boolean,
})

const SummaryEntry = Schema.Struct({
  name: Schema.String,
  tool: Schema.String,
  description: Schema.String,
  scope: OriginScope,
  filepath: Schema.String,
  tools: Schema.Array(Schema.String),
  extensions: Schema.Array(Extension),
})

const ListOutput = Schema.Struct({
  tools: Schema.Array(SummaryEntry),
})

const GetOutput = Schema.Struct({
  name: Schema.String,
  tool: Schema.String,
  description: Schema.String,
  scope: OriginScope,
  filepath: Schema.String,
  input: Schema.Record(Schema.String, Schema.Json),
  output: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  tools: Schema.Array(Schema.String),
  extensions: Schema.Array(Extension),
  code: Schema.String,
})

interface LoadedTool {
  readonly name: CodeModeCustomTool.Name
  readonly definition: CodeModeCustomTool.Definition
  readonly scope: OriginScope
  readonly filepath: string
}

// Saved tools are listed in full in the catalog, since a model only reuses a tool it can see. Past this many, the
// rest are found with search.
const PINNED_LIMIT = 24

interface Snapshot {
  readonly enabled: boolean
  readonly tools: ReadonlyMap<string, LoadedTool>
}

export const Plugin = {
  id: "opencode.tool.codemode-tools",
  effect: Effect.fn("CodeModeToolsPlugin")(function* (ctx: PluginContext) {
    const config = yield* Config.Service
    const flags = yield* Flag.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const registry = yield* Tool.Service
    const codeModeServices = yield* CodeModeTool.services
    const codeModeApi = yield* CodeModeApi.Service
    const codeModeAgents = yield* CodeModeAgents.Service

    // Tracks config roots created via opencode.tool.create before Config's watcher notices them.
    const extraDirectories = new Set<string>()
    const loadLock = Semaphore.makeUnsafe(1)

    const scopeFor = (filepath: string): OriginScope => {
      if (FSUtil.contains(global.config, filepath)) return "user"
      if (FSUtil.contains(location.directory, filepath)) return "project"
      return "config"
    }

    const loadDirectory = Effect.fnUntraced(function* (directory: string) {
      const files = yield* fs
        .scan("{tool,tools}/**/*.js", { cwd: directory, absolute: true, dot: true, symlink: true })
        .pipe(Effect.orElseSucceed(() => [] as string[]))
      return yield* Effect.forEach(files.toSorted(), (filepath) =>
        fs.readFileStringSafe(filepath).pipe(
          Effect.flatMap((content) =>
            content === undefined ? Effect.undefined : decodeFile(directory, filepath, content, scopeFor(filepath)),
          ),
          Effect.orElseSucceed(() => undefined),
        ),
      ).pipe(Effect.map((items) => items.filter((item): item is LoadedTool => item !== undefined)))
    })

    const loadSnapshot = Effect.fn("CodeModeToolsPlugin.load")(function* (): Effect.fn.Return<Snapshot> {
      const entries = yield* config.entries()
      const enabled = flags.resolve(entries).codemode_tools.enabled
      if (!enabled) return { enabled: false, tools: new Map() }
      const directories = collectDirectories(entries, extraDirectories)
      const loaded = new Map<string, LoadedTool>()
      for (const directory of directories) {
        const items = yield* loadDirectory(directory)
        for (const item of items) loaded.set(item.name.id, item)
      }
      return { enabled: true, tools: loaded }
    })

    const loaded = yield* ConfigEntryObserver.observeSources({
      config,
      event: ctx.event,
      directories: CodeModeCustomTool.DIRECTORIES,
      load: () => loadLock.withPermit(loadSnapshot().pipe(Effect.map((snapshot) => [snapshot]))),
      reload: ctx.tool.reload(),
    })

    const current = (): Snapshot => loaded.documents[0] ?? { enabled: false, tools: new Map() }

    const refreshNow = () =>
      loadLock.withPermit(
        loadSnapshot().pipe(
          Effect.tap((snapshot) => Effect.sync(() => (loaded.documents = [snapshot]))),
          Effect.andThen(ctx.tool.reload()),
        ),
      )

    const latest = Effect.fnUntraced(function* (registered: LoadedTool) {
      const loaded = current().tools.get(registered.name.id) ?? registered
      const content = yield* fs.readFileStringSafe(loaded.filepath).pipe(Effect.orElseSucceed(() => undefined))
      if (content === undefined) return loaded
      const parsed = CodeModeCustomTool.parseFile(content)
      if (Result.isFailure(parsed))
        return yield* new ToolFailure({
          message: `Custom tool "${loaded.name.qualified}" has an invalid file (${loaded.filepath}): ${parsed.failure}`,
        })
      if (
        parsed.success.code === loaded.definition.code &&
        parsed.success.description === loaded.definition.description
      )
        return loaded
      yield* refreshNow()
      return { ...loaded, definition: parsed.success }
    })

    const executeCustomTool = Effect.fn("CodeModeToolsPlugin.execute")(function* (
      registered: LoadedTool,
      args: unknown,
      context: Tool.Context,
    ) {
      if (context.automation !== undefined) {
        return yield* new ToolFailure({
          message: `Custom tool "${registered.name.qualified}" cannot run inside an unattended automation.`,
        })
      }
      // The file is the source of truth: an overwrite earlier in this script, or an edit by hand, runs as written.
      const item = yield* latest(registered)
      const depth = yield* CodeModeCustomTool.Depth
      const stack = yield* CodeModeCustomTool.CallStack
      if (depth >= CodeModeCustomTool.MAX_DEPTH) {
        const chain = [...stack, item.name.qualified].join(" -> ")
        return yield* new ToolFailure({
          message: `Custom tool call depth exceeded limit (${CodeModeCustomTool.MAX_DEPTH}): ${chain}`,
        })
      }

      const session = yield* sessions.get(context.sessionID)
      const agent = yield* agents.select(context.agent)
      if (!agent.info) return yield* new ToolFailure({ message: `Agent not found: ${agent.id}` })

      const policy = Permission.Policy.fromRules(agent.info.permissions, session.permissions ?? [])
      const [opencodeApi, codeModeAgentsEnabled] = yield* Effect.all(
        [flags.enabled("opencode_api"), flags.enabled("codemode_agents")],
        { concurrency: "unbounded" },
      )

      const result = yield* registry
        .check({
          code: item.definition.code,
          tools: item.definition.tools,
          bindings: { args: (args ?? {}) as CodeMode.DataValue },
          policy,
          limits: {},
          services: codeModeServices,
          api: Context.make(CodeModeApi.Service, opencodeApi ? codeModeApi : CodeModeApi.disabled).pipe(
            Context.add(Location.Service, location),
          ),
          ...(codeModeAgentsEnabled ? { agents: Context.make(CodeModeAgents.Service, codeModeAgents) } : {}),
          extensions: item.definition.extensions,
          context: {
            sessionID: context.sessionID,
            agent: context.agent,
            messageID: context.messageID,
            id: context.id,
            progress: () => Effect.void,
            cancel: context.cancel,
          },
        })
        .pipe(
          Effect.provideService(CodeModeCustomTool.Depth, depth + 1),
          Effect.provideService(CodeModeCustomTool.CallStack, [...stack, item.name.qualified]),
        )

      if (!result.ok) {
        return yield* new ToolFailure({ message: formatFailure(item.name.qualified, result) })
      }

      if (item.definition.compiledOutput !== undefined) {
        const checked = CodeModeAgents.check(item.definition.compiledOutput, result.value)
        if (Result.isFailure(checked)) {
          return yield* new ToolFailure({
            message: `Custom tool "${item.name.qualified}" returned an output that does not match its schema:\n${checked.failure}`,
          })
        }
        return {
          output: checked.success,
          content: formatSuccess(result, checked.success),
        }
      }

      return {
        output: result.value,
        content: formatSuccess(result, result.value),
      }
    })

    const assertWritePermission = Effect.fnUntraced(function* (
      filepath: string,
      context: Tool.Context,
      metadata: Record<string, Schema.Json>,
    ) {
      const target = yield* access.resolve({ path: filepath, kind: "file" })
      if (target.externalDirectory) {
        yield* permission.assert({
          action: target.externalDirectory.action,
          resources: [target.externalDirectory.resource],
          save: [target.externalDirectory.save],
          ...Permission.invocation(context),
        })
      }
      yield* permission.assert({
        action: "edit",
        resources: [target.resource],
        save: [FileAccess.always(target)],
        metadata,
        ...Permission.invocation(context),
      })
      return target
    })

    const rootForScope = (scope: Scope) => (scope === "user" ? global.config : path.join(location.directory, ".opencode"))

    const resolveDeleteTarget = Effect.fnUntraced(function* (parsed: CodeModeCustomTool.Name, scope: Scope | undefined) {
      if (scope !== undefined) {
        const root = rootForScope(scope)
        const primary = path.join(root, "tools", parsed.relativePath)
        if (yield* fs.exists(primary).pipe(Effect.orElseSucceed(() => false))) return primary
        const singular = path.join(root, "tool", parsed.relativePath)
        if (yield* fs.exists(singular).pipe(Effect.orElseSucceed(() => false))) return singular
        return yield* new ToolFailure({
          message: `Custom tool "${parsed.qualified}" was not found in ${scope} scope (${primary}).`,
        })
      }
      const active = current().tools.get(parsed.id)
      if (!active) {
        return yield* new ToolFailure({ message: `Custom tool "${parsed.qualified}" does not exist.` })
      }
      if (active.scope === "config") {
        return yield* new ToolFailure({
          message: `Custom tool "${parsed.qualified}" is defined outside this project and user config (${active.filepath}) and cannot be deleted with opencode.tool.delete.`,
        })
      }
      return active.filepath
    })

    yield* ctx.tool
      .transform((editor) => {
        const snapshot = current()
        if (!snapshot.enabled) return

        editor.add({
          name: "create",
          description: [
            "Save a script as a reusable tool, or replace one. Use it when the user wants something repeatable or asks to save a script; later sessions see it in their catalog as tools.custom.<name>(args). This one call is all it takes: no file to write, no directory to make, nothing to read first.",
            'Example: tools.opencode.tool.create({ name: "todo_count", description: "Count TODO comments in the *.ts files under a directory.", input: { type: "object", properties: { dir: { type: "string" } }, required: ["dir"] }, output: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] }, code: \'let count = 0\\nfor await (const file of new Bun.Glob("**/*.ts").scan({ cwd: args.dir })) count += (await Bun.file(args.dir + "/" + file).text()).split("TODO").length - 1\\nreturn { count }\', test: { dir: "src" } })',
            "Pass `test` to run it once and get its result back in the same call. Without `test`, call the tool from your next execute call: a script cannot see a tool it created itself.",
          ].join("\n"),
          input: CreateInput,
          output: CreateOutput,
          options: { namespace: "opencode.tool", codemode: { pinned: true }, permission: "edit" },
          execute: (input, context) =>
            Effect.gen(function* () {
              const parsed = CodeModeCustomTool.parseName(input.name)
              if (Result.isFailure(parsed)) return yield* new ToolFailure({ message: parsed.failure })

              const definition = CodeModeCustomTool.parseDefinition({
                description: input.description,
                ...(input.input === undefined ? {} : { input: input.input }),
                ...(input.output === undefined ? {} : { output: input.output }),
                code: input.code,
              })
              if (Result.isFailure(definition)) return yield* new ToolFailure({ message: definition.failure })

              const formatted = CodeModeCustomTool.formatFile({
                description: definition.success.description,
                ...(input.input === undefined ? {} : { input: input.input }),
                ...(input.output === undefined ? {} : { output: input.output }),
                code: definition.success.code,
              })
              const verified = CodeModeCustomTool.parseFile(formatted)
              if (Result.isFailure(verified)) {
                return yield* new ToolFailure({
                  message: `Generated custom tool file failed validation: ${verified.failure}`,
                })
              }

              const scope: Scope = input.scope ?? "project"
              const root = rootForScope(scope)
              const filepath = path.join(root, "tools", parsed.success.relativePath)
              const target = yield* assertWritePermission(filepath, context, {
                tool: parsed.success.qualified,
                scope,
                filepath,
                tools: [...definition.success.tools],
                extensions: [...definition.success.extensions],
                code: definition.success.code,
              })
              const existed = yield* fs.exists(target.absolute).pipe(Effect.orElseSucceed(() => false))
              yield* fs
                .writeWithDirs(target.absolute, formatted)
                .pipe(Effect.mapError((error) => new ToolFailure({ message: `Unable to write ${target.absolute}`, error })))
              extraDirectories.add(root)
              yield* refreshNow()

              const saved = `${existed ? "Updated" : "Created"} custom tool ${parsed.success.qualified} at ${target.absolute}.`
              const tested = yield* Effect.gen(function* () {
                if (input.test === undefined) return undefined
                const args = CodeModeAgents.compile(definition.success.input, false).pipe(
                  Result.flatMap((compiled) => CodeModeAgents.check(compiled, input.test)),
                )
                if (Result.isFailure(args))
                  return yield* new ToolFailure({ message: `\`test\` does not match the input schema:\n${args.failure}` })
                const ran = yield* executeCustomTool(
                  { name: parsed.success, definition: definition.success, scope, filepath: target.absolute },
                  input.test,
                  context,
                )
                return { value: ran.output as Schema.Json }
              }).pipe(
                Effect.mapError(
                  (error) =>
                    new ToolFailure({
                      message: `${saved} Its test run failed, so fix \`code\` and call create again:\n${error.message}`,
                    }),
                ),
              )
              const properties = Object.keys(
                (definition.success.input as { properties?: Record<string, unknown> }).properties ?? {},
              )
              const usage = `await ${toolExpression(parsed.success.qualified)}({ ${properties.join(", ")} })`
              const note = existed
                ? "Calls run the new code from now on."
                : "Call it from your next execute call; a script that was already running when it was created cannot see it."

              const output: typeof CreateOutput.Type = {
                name: parsed.success.id,
                tool: parsed.success.qualified,
                scope,
                filepath: target.absolute,
                created: !existed,
                usage,
                ...(tested === undefined ? {} : { result: tested.value }),
                note,
              }
              return {
                output,
                content: [saved, `Usage: ${usage}`, note, ...(tested === undefined ? [] : [`Test result: ${JSON.stringify(tested.value)}`])].join("\n"),
              }
            }).pipe(Effect.mapError(toolFailure(`Unable to save custom tool ${input.name}`))),
        })

        editor.add({
          name: "list",
          description: "List saved custom Code Mode tools with their scope, file path, and referenced capabilities.",
          input: Schema.Struct({}),
          output: ListOutput,
          options: { namespace: "opencode.tool", codemode: true },
          execute: () =>
            Effect.map(refreshNow(), () => {
              const items = Array.from(current().tools.values())
                .toSorted((left, right) => left.name.qualified.localeCompare(right.name.qualified))
                .map((item) => ({
                  name: item.name.id,
                  tool: item.name.qualified,
                  description: item.definition.description,
                  scope: item.scope,
                  filepath: item.filepath,
                  tools: [...item.definition.tools],
                  extensions: [...item.definition.extensions],
                }))
              return {
                output: { tools: items },
                content:
                  items.length === 0
                    ? "No custom tools saved."
                    : items.map((item) => `${item.tool} (${item.scope}): ${item.description}`).join("\n"),
              }
            }),
        })

        editor.add({
          name: "get",
          description: "Read a saved custom Code Mode tool's metadata, JSON Schemas, file path, and JavaScript source.",
          input: NameInput,
          output: GetOutput,
          options: { namespace: "opencode.tool", codemode: true },
          execute: (input) =>
            Effect.gen(function* () {
              const parsed = CodeModeCustomTool.parseName(input.name)
              if (Result.isFailure(parsed)) return yield* new ToolFailure({ message: parsed.failure })
              const item = current().tools.get(parsed.success.id)
              if (!item) {
                return yield* new ToolFailure({ message: `Custom tool "${parsed.success.qualified}" does not exist.` })
              }
              const output: typeof GetOutput.Type = {
                name: item.name.id,
                tool: item.name.qualified,
                description: item.definition.description,
                scope: item.scope,
                filepath: item.filepath,
                input: item.definition.input as Record<string, Schema.Json>,
                ...(item.definition.output === undefined
                  ? {}
                  : { output: item.definition.output as Record<string, Schema.Json> }),
                tools: [...item.definition.tools],
                extensions: [...item.definition.extensions],
                code: item.definition.code,
              }
              return { output, content: `${output.tool} (${output.filepath})\n\n${output.code}` }
            }),
        })

        editor.add({
          name: "delete",
          description: "Delete a saved custom Code Mode tool file from .opencode/tools/ or ~/.config/opencode/tools/.",
          input: DeleteInput,
          output: DeleteOutput,
          options: { namespace: "opencode.tool", codemode: true, permission: "edit" },
          execute: (input, context) =>
            Effect.gen(function* () {
              const parsed = CodeModeCustomTool.parseName(input.name)
              if (Result.isFailure(parsed)) return yield* new ToolFailure({ message: parsed.failure })
              const filepath = yield* resolveDeleteTarget(parsed.success, input.scope)
              const target = yield* assertWritePermission(filepath, context, {
                tool: parsed.success.qualified,
                filepath,
                delete: true,
              })
              yield* fs
                .remove(target.absolute, { force: true })
                .pipe(
                  Effect.mapError((error) => new ToolFailure({ message: `Unable to remove ${target.absolute}`, error })),
                )
              yield* refreshNow()
              return {
                output: {
                  name: parsed.success.id,
                  tool: parsed.success.qualified,
                  filepath: target.absolute,
                  removed: true,
                },
                content: `Deleted custom tool ${parsed.success.qualified} (${target.absolute}).`,
              }
            }).pipe(Effect.mapError(toolFailure(`Unable to delete custom tool ${input.name}`))),
        })

        if (snapshot.tools.size === 0) return

        editor.namespace({
          name: CodeModeCustomTool.NAMESPACE,
          description:
            "Tools this project's team saved for questions that come up again. Check these first: when one matches the task, call it instead of working the answer out by hand, use its result in the same script (it is plain data), and don't re-derive it to check. Any not shown: search({ namespace: \"custom\" }).",
        })

        const pinned = new Set(
          Array.from(snapshot.tools.values())
            .toSorted(
              (left, right) =>
                Number(right.scope === "project") - Number(left.scope === "project") ||
                left.name.qualified.localeCompare(right.name.qualified),
            )
            .slice(0, PINNED_LIMIT)
            .map((item) => item.name.id),
        )
        for (const item of snapshot.tools.values()) {
          editor.add({
            name: item.name.name,
            description: item.definition.description,
            input: item.definition.input,
            output: item.definition.output ?? {},
            options: { namespace: item.name.namespace, codemode: pinned.has(item.name.id) ? { pinned: true } : true },
            execute: (args, context) =>
              executeCustomTool(item, args, context).pipe(
                Effect.mapError(toolFailure(`Custom tool ${item.name.qualified} failed`)),
              ),
          })
        }
      })
      .pipe(Effect.orDie)
  }),
}

function collectDirectories(entries: readonly Entry[], extra: ReadonlySet<string>) {
  const seen = new Set<string>()
  const result: Array<string> = []
  const add = (directory: string) => {
    const normalized = path.resolve(directory)
    if (seen.has(normalized)) return
    seen.add(normalized)
    result.push(directory)
  }
  for (const entry of entries) {
    if (entry.type === "directory") add(entry.path)
  }
  for (const directory of extra) add(directory)
  return result
}

const decodeFile = Effect.fnUntraced(function* (
  directory: string,
  filepath: string,
  content: string,
  scope: OriginScope,
) {
  const name = CodeModeCustomTool.nameFromPath(directory, filepath)
  if (Result.isFailure(name)) {
    yield* Effect.logWarning("custom tool file skipped", { filepath, reason: name.failure })
    return undefined
  }
  const definition = CodeModeCustomTool.parseFile(content)
  if (Result.isFailure(definition)) {
    yield* Effect.logWarning("custom tool file skipped", { filepath, reason: definition.failure })
    return undefined
  }
  return {
    name: name.success,
    definition: definition.success,
    scope,
    filepath,
  } satisfies LoadedTool
})

function formatFailure(qualified: string, result: Extract<CodeMode.Result, { readonly ok: false }>) {
  const hints = (result.error.suggestions ?? []).filter((hint) => !result.error.message.includes(hint))
  const detail = [result.error.message, ...hints].join("\n").trim()
  const logs = result.logs && result.logs.length > 0 ? `\n\nLogs:\n${result.logs.join("\n")}` : ""
  // The saved file starts with a metadata header the script's line numbers do not count.
  const lines = /\(line \d+/.test(detail) ? " Line numbers count from the first line of the tool's code, after its header." : ""
  return `Custom tool "${qualified}" failed: ${detail}${lines}${logs}`
}

function formatSuccess(result: Extract<CodeMode.Result, { readonly ok: true }>, value: unknown) {
  const formatted = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))
  const warnings =
    result.warnings && result.warnings.length > 0
      ? `Warnings:\n${result.warnings.map((item) => `- [${item.kind}] ${item.message}`).join("\n")}`
      : undefined
  const logs = result.logs && result.logs.length > 0 ? `Logs:\n${result.logs.join("\n")}` : undefined
  const body = value === null && (warnings || logs) ? undefined : formatted
  return [body, warnings, logs].filter((part) => part !== undefined && part !== "").join("\n\n")
}
