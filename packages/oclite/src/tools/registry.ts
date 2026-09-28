import path from "path"
import { Effect, Layer, Schema } from "effect"
import {
  type AnyExecutableTool,
  type ToolDefinition,
  type ToolDispatchResult,
  type ToolSchema,
  Tool,
  ToolFailure,
  toDefinitions,
} from "@opencode-ai/llm"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import {
  AppConfig,
  Hooks,
  Permission,
  type Profile,
  type RunToolContext,
  ToolRegistry,
  type ToolStatus,
} from "../contract"
import { descriptions } from "../profile/profiles"
import { id } from "../util/paths"
import { bashTool } from "./bash"
import { extraTools } from "./extra"
import { type BuiltinTool, fsTools, MAX_BYTES, MAX_LINES, truncate } from "./fs"
import { searchTools } from "./search"
import { grammar } from "./text-protocol"

export type Describe = (profile: Profile, tool: string) => string | undefined
type Meta = { status: ToolStatus; overflow_path?: string; bytes: number }

/**
 * `describe` supplies per-profile descriptions (profile/profiles.ts `descriptions`); undefined falls back to
 * opencode's `.txt` text, bash via ShellPrompt.render.
 */
export function make(options: { describe?: Describe } = {}) {
  return Layer.effect(
    ToolRegistry,
    Effect.gen(function* () {
      const cfg = yield* AppConfig
      const permission = yield* Permission
      const hooks = yield* Hooks

      const wrap = (ctx: RunToolContext, item: BuiltinTool, description: string) =>
        Tool.make({
          description,
          jsonSchema: terse(ctx.profile, toDefinitions({ [item.name]: item.tool })[0].inputSchema),
          toModelOutput: (result) => [{ type: "text", text: (result.output as { text: string }).text }],
          toStructuredOutput: (output) => (output as { meta: Meta }).meta,
          execute: (raw, call) =>
            Effect.gen(function* () {
              // Optional parameters are advertised as `T | null`; a null means "omitted". Unknown keys are an error.
              const args = isRecord(raw)
                ? Object.fromEntries(Object.entries(raw).filter((entry) => entry[1] !== null))
                : raw
              const input = yield* Schema.decodeUnknownEffect(item.tool.parameters as ToolSchema<unknown>)(args, {
                onExcessProperty: "error",
              }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })))
              const access = item.access(input)
              const summary = item.summarize(input)
              const base = { session_id: ctx.session_id, agent: ctx.agent.name, ruleset: ctx.ruleset, summary }
              const check = (tool: string, patterns: string[], always?: string[], metadata?: Record<string, unknown>) =>
                permission
                  .check({ ...base, tool, patterns, always, metadata })
                  .pipe(Effect.mapError(() => failure("denied", `permission denied: ${tool} ${patterns.join(" ")}`)))
              for (const target of item.paths?.(input) ?? []) {
                const full = path.resolve(ctx.cwd, target.path)
                if ([ctx.cwd, cfg.projectRoot].some((root) => contains(root, full))) continue
                const glob = path.join(target.kind === "directory" ? full : path.dirname(full), "*")
                yield* check("external_directory", [glob], [glob], { filepath: full })
              }
              yield* check(access.permission, access.patterns, access.always, { input })
              const hook = { session_id: ctx.session_id, tool_name: item.name, tool_input: input, cwd: ctx.cwd }
              const pre = yield* hooks.run("PreToolUse", hook)
              if (pre.kind === "block") return yield* failure("blocked", `blocked: ${pre.message}`)
              if (pre.kind === "warn") yield* notice(ctx, pre.message)
              const timeoutMs = item.timeoutFor?.(input) ?? item.timeoutMs
              const callId = call?.id ?? id("call")
              const value: unknown = yield* item.tool.execute(input, call).pipe(
                Effect.timeoutOrElse({
                  duration: timeoutMs,
                  orElse: () => Effect.fail(failure("timeout", `timed out after ${timeoutMs / 1000} s`)),
                }),
                // Error text is model input too: same 2000-line / 50 KB cut as output.
                Effect.catch((error) =>
                  Effect.promise(() => truncate(error.message, ctx.session_id, callId)).pipe(
                    Effect.flatMap((cut) =>
                      Effect.fail(new ToolFailure({ message: cut.text, error: error.error, metadata: error.metadata })),
                    ),
                  ),
                ),
              )
              // Built-in and MCP tools return text; anything else is shown as JSON.
              const output = typeof value === "string" ? value : JSON.stringify(value)
              const result = yield* Effect.promise(() => truncate(output, ctx.session_id, callId))
              const post = yield* hooks.run("PostToolUse", { ...hook, tool_output: result.text })
              if (post.kind === "warn") yield* notice(ctx, post.message)
              // PostToolUse exit 2 can't undo the call; its stderr goes to the model with the output (Claude Code does the same).
              const text = post.kind === "block" ? `${result.text}\n\n<hook>${post.message}</hook>` : result.text
              return { text, meta: { status: "ok" as const, overflow_path: result.overflow_path, bytes: result.bytes } }
            }),
        })

      return ToolRegistry.of({
        build: (ctx, extra, caps) =>
          Effect.gen(function* () {
            const selected = new Set([
              ...ctx.profile.tools,
              ...ctx.profile.optionalTools.filter((name) => ctx.agent.tools?.includes(name)),
            ])
            const builtins = [...fsTools(ctx), ...searchTools(ctx), bashTool(ctx), ...extraTools(ctx, cfg)]
            const candidates: BuiltinTool[] = [
              ...builtins.filter((item) => selected.has(item.name)),
              ...extra.filter(
                (item) => item.name.startsWith("mcp__") || item.name === "tool_search" || selected.has(item.name),
              ),
            ]
            const visible = candidates.filter((item) => !hidden(item.name, ctx.ruleset))
            const described = yield* Effect.forEach(visible, (item) =>
              Effect.promise(
                async () => [item.name, wrap(ctx, item, await describe(options.describe, ctx.profile, item))] as const,
              ),
            )
            const tools: Record<string, AnyExecutableTool> = Object.fromEntries(described)
            const deferred = ctx.profile.mcp === "deferred"
            const active = new Set(
              visible.map((item) => item.name).filter((name) => !(deferred && name.startsWith("mcp__"))),
            )
            const cache: { definitions?: ToolDefinition[] } = {}
            // Sorted by name and rebuilt only on activation, so the request prefix stays byte-identical across turns.
            const definitions = () =>
              (cache.definitions ??= [
                ...toDefinitions(Object.fromEntries([...active].sort().map((name) => [name, tools[name]]))),
              ])
            return {
              tools,
              get definitions() {
                return caps.tools_native ? definitions() : []
              },
              get textProtocolPrompt() {
                return caps.tools_native ? undefined : grammar(definitions())
              },
              readOnly: new Set(visible.filter((item) => item.readOnly).map((item) => item.name)),
              activate: (names) =>
                Effect.sync(() => {
                  names.filter((name) => name in tools && !active.has(name)).forEach((name) => active.add(name))
                  cache.definitions = undefined
                }),
            }
          }),
      })
    }),
  )
}

export const layer = make({ describe: descriptions })

/** Status, text and overflow path of a dispatched call, for tool_end events and tool_result records. */
export function outcome(result: ToolDispatchResult) {
  if (result.result.type === "error") {
    const error = result.events.find((event) => event.type === "tool-error")?.error
    const status = isRecord(error) && typeof error.status === "string" ? (error.status as ToolStatus) : "error"
    const text = String(result.result.value)
    return { status, text, bytes: Buffer.byteLength(text) }
  }
  const meta = result.output?.structured as Meta | undefined
  const text = result.output?.content.map((part) => (part.type === "text" ? part.text : "")).join("") ?? ""
  return { status: meta?.status ?? "ok", text, overflow_path: meta?.overflow_path, bytes: meta?.bytes ?? text.length }
}

async function describe(resolve: Describe | undefined, profile: Profile, item: BuiltinTool) {
  const custom = resolve?.(profile, item.name)
  if (custom !== undefined) return custom
  // MCP descriptions are `[server] …` from mcp/tools.ts, cut to the profile limit.
  if (item.name.startsWith("mcp__")) return item.tool.description.slice(0, profile.descriptionMaxChars)
  if (item.name !== "bash") return item.tool.description
  // Lazy: ShellPrompt pulls core/global. Same limits and default timeout as tools/bash.ts.
  const { ShellPrompt } = await import("opencode/tool/shell/prompt")
  return ShellPrompt.render("bash", process.platform, { maxLines: MAX_LINES, maxBytes: MAX_BYTES }, 120_000).description
}

// Same rule as opencode's Permission.disabled: a tool whose last matching rule is a blanket deny isn't offered.
function hidden(name: string, ruleset: RunToolContext["ruleset"]) {
  const rule = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
  return rule?.pattern === "*" && rule.action === "deny"
}

function contains(root: string, full: string) {
  const relative = path.relative(root, full)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function failure(status: ToolStatus, message: string) {
  return new ToolFailure({ message, error: { status }, metadata: { status } })
}

function notice(ctx: RunToolContext, message: string) {
  return ctx.sink({
    session_id: ctx.session_id,
    agent_path: [ctx.agent.name],
    type: "status",
    phase: "notice",
    message,
  })
}

// [cli-engineer, Phase 3 integration] local-min: per-parameter descriptions cost ~220 tok over its 4 tools and
// pushed the real first request to 739 > 600 tok; names, types and `required` stay. Owner (tools/perf) to review.
// [mcp-engineer, Phase 4] local profiles also drop `additionalProperties: false` (~7 tok per tool), which pushed
// local + tool_search past 1200. Built-ins still reject unknown keys in the decode below. MCP tools don't decode
// locally (Tool.make jsonSchema → Schema.Unknown), so unknown keys are the server's to reject; their permission
// pattern is "*", so this widens nothing.
function terse<S extends Record<string, unknown>>(profile: Profile, schema: S): S {
  if (profile.name === "default" || !isRecord(schema.properties)) return schema
  const open = Object.fromEntries(Object.entries(schema).filter((entry) => !(entry[0] === "additionalProperties" && entry[1] === false))) as S
  if (profile.name !== "local-min") return open
  const properties = Object.entries(schema.properties).map(([key, value]) => [
    key,
    isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry) => entry[0] !== "description")) : value,
  ])
  return { ...open, properties: Object.fromEntries(properties) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
