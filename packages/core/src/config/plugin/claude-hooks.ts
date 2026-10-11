export * as ConfigClaudeHooksPlugin from "./claude-hooks.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import path from "path"
import { Effect, Option, Predicate, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { Config } from "../../config.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { normalizeContent } from "../../tool/runtime.js"

// Runs the PreToolUse and PostToolUse command hooks from Claude Code settings files, using the same
// stdin payload, exit codes and JSON output: exit 2 blocks the call (or reports back after it) with stderr
// as the reason, and exit 0 may print a JSON decision on stdout.

type Event = "PreToolUse" | "PostToolUse"
type Hook = { readonly matcher: string; readonly command: string; readonly timeout: number }
export type Decision =
  | { readonly type: "deny"; readonly reason?: string }
  | { readonly type: "ask"; readonly reason?: string }
  | { readonly type: "feedback"; readonly text: string }

const files = ["settings.json", "settings.local.json"]
const defaultTimeout = 60
const askKey = "claudeHookAsk"
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

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

// Reads the JSON a hook prints on exit 0. "allow" is not honored: a hook can tighten permissions, not loosen them.
export function decision(event: Event, stdout: string): Decision | undefined {
  const output = Option.getOrUndefined(decodeJson(stdout.trim()))
  if (!Predicate.isObject(output)) return
  const specific = Predicate.isObject(output.hookSpecificOutput) ? output.hookSpecificOutput : {}
  if (event === "PreToolUse") {
    const permission = specific.permissionDecision
    if (permission === "deny" || permission === "ask")
      return { type: permission, reason: text(specific.permissionDecisionReason) }
    // older Claude Code form
    if (output.decision === "block") return { type: "deny", reason: text(output.reason) }
    return
  }
  const feedback = [output.decision === "block" ? text(output.reason) : undefined, text(specific.additionalContext)]
    .filter((item) => item !== undefined)
    .join("\n")
  return feedback ? { type: "feedback", text: feedback } : undefined
}

function outcome(event: Event, result: AppProcess.RunResult): Decision | undefined {
  if (result.exitCode === 0) return decision(event, result.stdout.toString("utf8"))
  if (result.exitCode !== 2) return
  const stderr = text(result.stderr.toString("utf8"))
  if (event === "PreToolUse") return { type: "deny", reason: stderr }
  return stderr ? { type: "feedback", text: stderr } : undefined
}

// what the permission prompt shows for an ask
function resource(input: unknown) {
  if (!Predicate.isObject(input)) return
  return text(input.command) ?? text(input.path) ?? text(input.url) ?? text(input.pattern)
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
    const permission = yield* Permission.Service
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

    // A deny from any hook wins over an ask. Hooks that fail or time out never block a tool call.
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
      const results: Decision[] = []
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
        const found = result && outcome(event, result)
        if (found?.type === "deny") return { ...found, reason: found.reason ?? `${event} hook blocked ${tool}` }
        if (found) results.push(found)
      }
      const ask = results.find((item) => item.type === "ask")
      if (ask) return ask
      const feedback = results.flatMap((item) => (item.type === "feedback" ? [item.text] : []))
      return feedback.length > 0 ? { type: "feedback" as const, text: feedback.join("\n") } : undefined
    })

    yield* config.changes().pipe(
      Stream.runForEach(() => refresh()),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh()

    // Ask requests carry this key, so the evaluate hook can turn them into a prompt even when rules allow the tool.
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        if (!Predicate.isObject(event.metadata) || !(askKey in event.metadata) || event.effect === "deny") return
        event.effect = "ask"
        event.message = text(event.metadata[askKey])
      }),
    )

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        const result = yield* run("PreToolUse", event)
        if (result?.type === "deny") return yield* new Tool.Error({ message: result.reason ?? "" })
        if (result?.type !== "ask") return
        yield* permission
          .assert({
            sessionID: event.sessionID,
            agent: event.agent,
            action: event.tool,
            resources: [resource(event.input) ?? "*"],
            metadata: { [askKey]: result.reason ?? "" },
            source: { type: "tool", messageID: event.messageID, id: event.id },
          })
          .pipe(
            Effect.catchTags({
              "Permission.BlockedError": (error) => Effect.fail(new Tool.Error({ message: error.message })),
              "Permission.CorrectedError": (error) => Effect.fail(new Tool.Error({ message: error.feedback })),
              "Session.NotFoundError": (error) => Effect.fail(new Tool.Error({ message: String(error) })),
            }),
          )
      }),
    )
    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.status !== "completed") return
        const result = yield* run("PostToolUse", event, event.result.output ?? event.result.content)
        if (result?.type !== "feedback") return
        event.result = {
          ...event.result,
          content: [
            ...normalizeContent(event.result.content, event.result.output),
            { type: "text", text: result.text },
          ],
        }
      }),
    )
  }),
})
