import path from "path"
import { Effect, Layer, Semaphore } from "effect"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { deriveSubagentSessionPermission } from "opencode/agent/subagent-permissions"
import {
  AppConfig,
  Asker,
  type AskerShape,
  type AskReply,
  type AskRequest,
  type PermissionMode,
  Permission,
  type RecordInput,
  SessionStore,
} from "../contract"
import { evaluate, fromConfig } from "../forked/permission-rules"
import { dataDir, id } from "../util/paths"

// opencode's .env read guard (mirrors the gitignore Node pattern). It survives bypassPermissions.
const ENV_GUARD = fromConfig({ read: { "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" } })
const READ_ONLY_BASH = ["git status*", "git diff*", "git log*", "ls*", "pwd"]
// git diff/log can still write files or run an external diff program.
const GIT_WRITES = ["diff", "log"].flatMap((sub) =>
  ["*--output*", "* -o*", "*--ext-diff*"].map((flag) => `git ${sub}${flag}`),
)
// Asks are serialized per process: two prompts at once would interleave on the terminal or the MCP client.
const asking = Semaphore.makeUnsafe(1)

const headless: AskerShape = { ask: () => Effect.succeed("reject") }
/** `-p` / non-interactive runs: every ask is rejected at once and counted as a denial. */
export const headlessAsker = Layer.succeed(Asker, headless)

export function defaults(): PermissionV1.Rule[] {
  return [
    ...fromConfig({
      "*": "ask",
      read: "allow",
      glob: "allow",
      grep: "allow",
      todowrite: "allow",
      skill: "allow",
      tool_search: "allow",
      question: "allow",
      external_directory: "ask",
    }),
    // Truncated tool output is written here and the hint tells the model to read it back.
    { permission: "external_directory", pattern: path.join(dataDir(), "tool-output", "*"), action: "allow" },
    ...ENV_GUARD,
  ]
}

export function readOnlyRules(mcpReadOnly: readonly string[]): PermissionV1.Rule[] {
  return [
    ...fromConfig({ edit: "deny", write: "deny", apply_patch: "deny", "mcp__*": "deny", bash: "deny" }),
    ...READ_ONLY_BASH.map((pattern) => ({ permission: "bash", pattern, action: "allow" as const })),
    ...GIT_WRITES.map((pattern) => ({ permission: "bash", pattern, action: "deny" as const })),
    ...mcpReadOnly.map((permission) => ({ permission, pattern: "*", action: "allow" as const })),
  ]
}

export function modeRules(
  mode: PermissionMode,
  readOnly: boolean,
  mcpReadOnly: readonly string[],
): PermissionV1.Rule[] {
  return [
    ...(mode === "bypassPermissions"
      ? [{ permission: "*", pattern: "*", action: "allow" as const }, ...ENV_GUARD]
      : []),
    ...(mode === "acceptEdits" ? fromConfig({ edit: "allow", write: "allow" }) : []),
    ...(mode === "plan" || readOnly ? readOnlyRules(mcpReadOnly) : []),
  ]
}

export const layer = Layer.effect(
  Permission,
  Effect.gen(function* () {
    const cfg = yield* AppConfig
    const asker = yield* Asker
    const store = yield* SessionStore
    const approved = new Map<string, PermissionV1.Rule[]>()
    const denied = new Map<string, number>()
    const via = asker === headless ? ("headless" as const) : ("repl" as const)

    // `always` replies are session-scoped and persisted as permission records, so a resumed session reapplies them.
    const sessionAlways = Effect.fn("Permission.sessionAlways")(function* (session_id: string) {
      const existing = approved.get(session_id)
      if (existing) return existing
      const records = yield* store.read(session_id)
      const rules = records.flatMap((record) =>
        record.type === "permission" && record.reply === "always"
          ? (record.always ?? []).map((pattern) => ({ permission: record.tool, pattern, action: "allow" as const }))
          : [],
      )
      const current = approved.get(session_id) ?? rules
      approved.set(session_id, current)
      return current
    })

    const record = (
      session_id: string,
      input: Omit<Extract<RecordInput, { type: "permission" }>, "type" | "request_id"> & { request_id?: string },
    ) => store.append(session_id, { ...input, type: "permission", request_id: input.request_id ?? id("per") })

    const countDenial = (session_id: string) =>
      Effect.sync(() => denied.set(session_id, (denied.get(session_id) ?? 0) + 1))

    return Permission.of({
      ruleset: (input) => {
        const parent = input.parent
          ? deriveSubagentSessionPermission({
              parentSessionPermission: input.parent,
              // Only `permission` is read. AgentDef.model is a "provider/model" string, Agent.Info's is a ref object.
              subagent: { ...input.agent, model: undefined, permission: [...input.agent.permission] },
            })
          : []
        const readOnly = input.mode === "plan" || input.agent.read_only
        return [
          ...defaults(),
          ...cfg.permission,
          ...input.agent.permission,
          ...modeRules(input.mode, input.agent.read_only, input.mcpReadOnly),
          ...parent,
          ...cfg.cliRules,
          // --allowed-tools can't lift read_only; CLI and parent denies stay last so nothing after them re-allows.
          ...(readOnly ? readOnlyRules(input.mcpReadOnly) : []),
          ...cfg.cliRules.filter((rule) => rule.action === "deny"),
          ...parent.filter((rule) => rule.action === "deny"),
        ]
      },
      check: Effect.fn("Permission.check")(function* (input) {
        const always = yield* sessionAlways(input.session_id)
        const decisions = input.patterns.map((pattern) => decide(input.tool, pattern, input.ruleset, always))
        const base = { tool: input.tool, patterns: input.patterns }
        if (decisions.includes("deny")) {
          yield* record(input.session_id, { ...base, decision: "deny", via: "rule" })
          yield* countDenial(input.session_id)
          return yield* new PermissionV1.DeniedError({
            ruleset: input.ruleset.filter((rule) => Wildcard.match(input.tool, rule.permission)),
          })
        }
        if (decisions.every((decision) => decision === "allow")) {
          yield* record(input.session_id, { ...base, decision: "allow", via: "rule" })
          return
        }
        const request: AskRequest = {
          request_id: id("per"),
          session_id: input.session_id,
          agent: input.agent,
          tool: input.tool,
          patterns: input.patterns,
          always: input.always ?? [],
          summary: input.summary,
          metadata: input.metadata ?? {},
        }
        const outcome = yield* asking.withPermits(1)(
          Effect.gen(function* () {
            // Another ask may have answered `always` for these patterns while this one waited for the permit.
            if (input.patterns.every((pattern) => decide(input.tool, pattern, input.ruleset, always) === "allow"))
              return { reply: "once" as AskReply, via: "rule" as const }
            return yield* asker.ask(request).pipe(
              Effect.map((reply) => ({ reply, via })),
              Effect.timeoutOrElse({
                duration: cfg.permission_timeout_ms,
                orElse: () => Effect.succeed({ reply: "reject" as AskReply, via: "timeout" as const }),
              }),
            )
          }),
        )
        yield* record(input.session_id, {
          request_id: request.request_id,
          ...base,
          decision: "ask",
          reply: outcome.reply,
          via: outcome.via,
          ...(outcome.reply === "always" ? { always: request.always } : {}),
        })
        if (outcome.reply === "reject") {
          yield* countDenial(input.session_id)
          return yield* new PermissionV1.RejectedError()
        }
        if (outcome.reply === "always")
          always.push(
            ...request.always.map((pattern) => ({ permission: input.tool, pattern, action: "allow" as const })),
          )
      }),
      denials: (session_id) => Effect.sync(() => denied.get(session_id) ?? 0),
    })
  }),
)

// A session `always` only turns an ask into an allow; it never overrides a deny (CLI, parent, mode or config).
function decide(tool: string, pattern: string, ruleset: PermissionV1.Ruleset, always: PermissionV1.Ruleset) {
  const action = evaluate(tool, pattern, ruleset).action
  if (action !== "ask") return action
  return evaluate(tool, pattern, always).action === "allow" ? "allow" : "ask"
}
