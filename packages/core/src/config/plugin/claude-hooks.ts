export * as ConfigClaudeHooksPlugin from "./claude-hooks.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import path from "path"
import { Effect, Option, Predicate, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "../../config.js"
import { Location } from "../../location.js"
import { normalizeContent } from "../../tool/runtime.js"

// Runs the PreToolUse and PostToolUse command hooks from Claude Code settings files, using the same
// stdin payload and exit codes: 2 blocks the call (or reports back after it) with stderr as the reason.

type Event = "PreToolUse" | "PostToolUse"
type Hook = { readonly matcher: string; readonly command: string; readonly timeout: number }

const files = ["settings.json", "settings.local.json"]
const defaultTimeout = 60
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

// Claude Code tool and input names, so matchers and scripts written for it keep working.
const tools: Record<string, string> = {
  shell: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  glob: "Glob",
  grep: "Grep",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  subagent: "Task",
  skill: "Skill",
  question: "AskUserQuestion",
}
const fields: Record<string, string> = {
  path: "file_path",
  oldString: "old_string",
  newString: "new_string",
  replaceAll: "replace_all",
}

export function parse(text: string): Record<Event, Hook[]> {
  const settings = Option.getOrUndefined(decodeJson(text))
  const hooks = Predicate.isObject(settings) && Predicate.isObject(settings.hooks) ? settings.hooks : {}
  const list = (event: Event) =>
    (Array.isArray(hooks[event]) ? hooks[event] : []).flatMap((group: unknown) => {
      if (!Predicate.isObject(group) || !Array.isArray(group.hooks)) return []
      const matcher = typeof group.matcher === "string" ? group.matcher : ""
      return group.hooks.flatMap((hook: unknown) => {
        if (!Predicate.isObject(hook) || hook.type !== "command" || typeof hook.command !== "string") return []
        return [
          {
            matcher,
            command: hook.command,
            timeout: typeof hook.timeout === "number" && hook.timeout > 0 ? hook.timeout : defaultTimeout,
          },
        ]
      })
    })
  return { PreToolUse: list("PreToolUse"), PostToolUse: list("PostToolUse") }
}

export function matches(matcher: string, tool: string) {
  if (matcher === "" || matcher === "*") return true
  // An invalid pattern matches nothing rather than every tool.
  return Option.getOrElse(Option.liftThrowable(() => new RegExp(`^(?:${matcher})$`).test(tool))(), () => false)
}

export function toolInput(input: unknown) {
  if (!Predicate.isObject(input)) return input
  return {
    ...input,
    ...Object.fromEntries(Object.entries(fields).flatMap(([from, to]) => (from in input ? [[to, input[from]]] : []))),
  }
}

export const Plugin = define({
  id: "opencode.config.claude-hooks",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const global = yield* Global.Service
    const runner = yield* AppProcess.Service
    const loaded: Record<Event, Hook[]> = { PreToolUse: [], PostToolUse: [] }

    const refresh = Effect.fn("ConfigClaudeHooksPlugin.refresh")(function* () {
      // Only the user's own settings: hooks in a project's .claude directory would run commands from a
      // repository the user has not reviewed.
      const home = path.join(global.home, ".claude")
      const roots = (config.compatibility ? (yield* config.compatibility()).claude : []).filter((root) => root === home)
      const parsed = yield* Effect.forEach(
        roots.flatMap((root) => files.map((file) => path.join(root, file))),
        (file) =>
          fs.readFileStringSafe(file).pipe(
            Effect.orElseSucceed(() => undefined),
            Effect.map((text) => parse(text ?? "")),
          ),
      )
      loaded.PreToolUse = parsed.flatMap((item) => item.PreToolUse)
      loaded.PostToolUse = parsed.flatMap((item) => item.PostToolUse)
    })

    // Returns the stderr of the first hook that exits 2. Other failures never block a tool call.
    const run = Effect.fn("ConfigClaudeHooksPlugin.run")(function* (
      event: Event,
      input: { readonly tool: string; readonly sessionID: string; readonly id: string; readonly input: unknown },
      response?: unknown,
    ) {
      const tool = tools[input.tool] ?? input.tool
      const hooks = loaded[event].filter((hook) => matches(hook.matcher, tool))
      if (hooks.length === 0) return
      const stdin = JSON.stringify({
        session_id: input.sessionID,
        cwd: location.directory,
        hook_event_name: event,
        tool_name: tool,
        tool_input: toolInput(input.input),
        tool_use_id: input.id,
        ...(response === undefined ? {} : { tool_response: response }),
      })
      for (const hook of hooks) {
        const result = yield* runner
          .run(
            ChildProcess.make(hook.command, [], {
              shell: true,
              cwd: location.directory,
              extendEnv: true,
              env: { CLAUDE_PROJECT_DIR: location.directory },
            }),
            { stdin, timeout: `${hook.timeout} seconds` },
          )
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("claude hook failed", { command: hook.command, error }).pipe(Effect.as(undefined)),
            ),
          )
        if (result?.exitCode === 2) return result.stderr.toString("utf8").trim() || `${event} hook blocked ${tool}`
      }
    })

    yield* config.changes().pipe(
      Stream.runForEach(() => refresh()),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh()

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        const blocked = yield* run("PreToolUse", event)
        if (blocked) return yield* new Tool.Error({ message: blocked })
      }),
    )
    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.status !== "completed") return
        const feedback = yield* run("PostToolUse", event, event.result.output ?? event.result.content)
        if (!feedback) return
        event.result = {
          ...event.result,
          content: [...normalizeContent(event.result.content, event.result.output), { type: "text", text: feedback }],
        }
      }),
    )
  }),
})
