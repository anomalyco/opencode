import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Deferred, Effect, Layer, Context } from "effect"
import os from "os"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { Hitl } from "@/permission/hitl"
import { Sandbox } from "@/permission/sandbox"
import { Guard } from "@/permission/guard"
import { Risk } from "@/permission/risk"
import { containsPath, type InstanceContext } from "@/project/instance-context"
import path from "path"

export const Event = PermissionV1.Event

// Human-in-the-loop context carries the dimensions that only the call site
// knows (tool name, agent, provider, workspace); operation, pattern, and
// command come from the request itself.
export type AskInput = PermissionV1.AskInput & { readonly hitl?: Hitl.Context }

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<PermissionV1.Action, PermissionV1.Error>
  readonly reply: (input: PermissionV1.ReplyInput) => Effect.Effect<void, PermissionV1.NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<PermissionV1.Request>>
}

interface PendingEntry {
  info: PermissionV1.Request
  deferred: Deferred.Deferred<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>
  // Execution mode granted for this request; persisted into the approved
  // ruleset on "always" so sandbox intent survives the session.
  action: PermissionV1.Action
}

interface State {
  pending: Map<PermissionV1.ID, PendingEntry>
  approved: PermissionV1.Rule[]
}

export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        void ctx
        const state = {
          pending: new Map<PermissionV1.ID, PendingEntry>(),
          approved: [],
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const { ruleset, hitl, ...request } = input
      const cfg = yield* config.get()
      // InstanceState.get already requires the instance context, so the
      // session worktree is always available for the confirmation gate.
      const instance = yield* InstanceState.context
      const command = typeof request.metadata.command === "string" ? request.metadata.command : undefined
      let needsAsk = false
      // Execution mode granted across all patterns: the most protective
      // resolution wins, and a plain allow never downgrades a sandboxed one.
      let granted: PermissionV1.Action = "allow"
      let unavailable = false
      const record = (action: PermissionV1.Action) => {
        if (action === "restricted-network") granted = "restricted-network"
        if (action === "sandbox" && granted === "allow") granted = "sandbox"
      }

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        yield* Effect.logInfo("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny") {
          return yield* new PermissionV1.DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }

        // A session "always" approval already satisfied the human
        // confirmation gate; sandbox intent still has to resolve so an
        // approved sandboxed rule keeps executing inside the sandbox.
        if (evaluate(request.permission, pattern, approved).action !== "ask") {
          if (rule.action === "sandbox" || rule.action === "restricted-network") {
            const verdict = Sandbox.resolve(rule.action, request.permission)
            if (verdict === "deny") {
              return yield* new PermissionV1.DeniedError({
                ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
              })
            }
            record(verdict === "ask" ? "allow" : verdict)
          } else {
            record("allow")
          }
          continue
        }

        const action = rule.action
        if (action === "trusted-command" || action === "trusted-domain") {
          // Explicit trust in config: bypasses confirmation and guards.
          record("allow")
          continue
        }

        if (action === "sandbox" || action === "restricted-network") {
          const verdict = Sandbox.resolve(action, request.permission)
          if (verdict === "deny") {
            return yield* new PermissionV1.DeniedError({
              ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
            })
          }
          if (verdict === "ask") {
            // The environment cannot enforce the requested mode: confirm
            // explicitly and mark the request as unenforced instead of
            // silently running without isolation.
            needsAsk = true
            unavailable = true
            record("allow")
            yield* Effect.logWarning("sandbox unavailable", {
              permission: request.permission,
              pattern,
              reason: Sandbox.availability().reason,
            })
            continue
          }
          record(verdict)
        } else if (action === "read-only") {
          if (Risk.classify(request.permission, command) !== "readonly") {
            needsAsk = true
            record("allow")
            continue
          }
          record("allow")
        } else if (action === "isolated-workspace") {
          if (!insideWorkspace(pattern, request.metadata, instance)) {
            needsAsk = true
            record("allow")
            continue
          }
          record("allow")
        } else if (action === "allow") {
          record("allow")
        } else {
          // Plain confirmation, or an unknown action from a newer schema:
          // fail safe and ask.
          needsAsk = true
          record("allow")
          continue
        }

        // Guard layer: the phase-8 protections upgrade an allowed command
        // to a confirmation on their own terms (trusted-* never gets here).
        if (Guard.evaluate({ permission: request.permission, command }) === "ask") needsAsk = true

        const decision = Hitl.evaluate(cfg.human_in_the_loop, {
          operation: request.permission,
          pattern,
          command,
          tool: hitl?.tool,
          agent: hitl?.agent,
          provider: hitl?.provider,
          workspace: hitl?.workspace ?? instance.worktree,
        })
        if (decision === "ask") needsAsk = true
      }

      if (!needsAsk) return granted

      const id = request.id ?? PermissionV1.ID.ascending()
      const info: PermissionV1.Request = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: unavailable ? { ...request.metadata, sandbox: "unavailable" } : request.metadata,
        always: request.always,
        tool: request.tool,
      }
      yield* Effect.logInfo("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>()
      pending.set(id, { info, deferred, action: granted })
      yield* events.publish(Event.Asked, info)
      yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
      return granted
    })

    const reply = Effect.fn("Permission.reply")(function* (input: PermissionV1.ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return yield* new PermissionV1.NotFoundError({ requestID: input.requestID })

      pending.delete(input.requestID)
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new PermissionV1.CorrectedError({ feedback: input.message })
            : new PermissionV1.RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* events.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      for (const pattern of existing.info.always) {
        approved.push({
          permission: existing.info.permission,
          pattern,
          action: existing.action,
        })
      }

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok = item.info.patterns.every(
          (pattern) => evaluate(item.info.permission, pattern, approved).action !== "ask",
        )
        if (!ok) continue
        pending.delete(id)
        yield* events.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, reply, list })
  }),
)

// Target is path-scoped only when it looks like a filesystem path; URLs and
// bare command tokens (bash arity prefixes such as `git status`) rely on the
// existing external_directory gate instead.
function insideWorkspace(
  pattern: string,
  metadata: PermissionV1.Request["metadata"],
  instance: InstanceContext,
): boolean {
  const target = typeof metadata.filepath === "string" ? metadata.filepath : pattern
  if (/^https?:\/\//i.test(target)) return true
  if (target.startsWith("~") || target.startsWith("$HOME")) return false
  if (!path.isAbsolute(target) && !target.includes("/") && !target.includes("\\")) return true
  const resolved = path.isAbsolute(target) ? target : path.resolve(instance.worktree, target)
  return containsPath(resolved, instance)
}

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermissionV1.Info) {
  const ruleset: PermissionV1.Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule[] {
  return rulesets.flat()
}

export function disabled(tools: string[], ruleset: PermissionV1.Ruleset): Set<string> {
  const edits = ["edit", "write", "apply_patch"]
  const reads = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]
  return new Set(
    tools.filter((tool) => {
      const permission = edits.includes(tool) ? "edit" : reads.includes(tool) ? "read" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}

export function visibleTools<T>(tools: Record<string, T>, ruleset: PermissionV1.Ruleset): Record<string, T> {
  const hidden = disabled(Object.keys(tools), ruleset)
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !hidden.has(name)))
}

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, Config.node] })

export * as Permission from "."
