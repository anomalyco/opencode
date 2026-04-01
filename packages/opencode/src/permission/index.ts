import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { ProjectID } from "@/project/schema"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { Deferred, Effect, Layer, Schema, ServiceMap } from "effect"
import os from "os"
import z from "zod"
import { evaluate as evalRule } from "./evaluate"
import { PermissionID, PermissionMode, DEFAULT_PERMISSION_MODE } from "./schema"
import { evaluatePermissionForMode } from "./mode"
import { checkDangerousPattern, ALL_DANGEROUS_PATTERNS } from "@/tool/bash-dangerous"

export namespace Permission {
  const log = Log.create({ service: "permission" })

  export const Action = z.enum(["allow", "deny", "ask"]).meta({
    ref: "PermissionAction",
  })
  export type Action = z.infer<typeof Action>

  export const Rule = z
    .object({
      permission: z.string(),
      pattern: z.string(),
      action: Action,
    })
    .meta({
      ref: "PermissionRule",
    })
  export type Rule = z.infer<typeof Rule>

  export const Ruleset = Rule.array().meta({
    ref: "PermissionRuleset",
  })
  export type Ruleset = z.infer<typeof Ruleset>

  export const Request = z
    .object({
      id: PermissionID.zod,
      sessionID: SessionID.zod,
      permission: z.string(),
      patterns: z.string().array(),
      metadata: z.record(z.string(), z.any()),
      always: z.string().array(),
      tool: z
        .object({
          messageID: MessageID.zod,
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "PermissionRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Reply = z.enum(["once", "always", "reject"])
  export type Reply = z.infer<typeof Reply>

  export const Approval = z.object({
    projectID: ProjectID.zod,
    patterns: z.string().array(),
  })

  export const Event = {
    Asked: BusEvent.define("permission.asked", Request),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: SessionID.zod,
        requestID: PermissionID.zod,
        reply: Reply,
      }),
    ),
  }

  export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
    override get message() {
      return "The user rejected permission to use this specific tool call."
    }
  }

  export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
    feedback: Schema.String,
  }) {
    override get message() {
      return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
    }
  }

  export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
    ruleset: Schema.Any,
  }) {
    override get message() {
      return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
    }
  }

  export type Error = DeniedError | RejectedError | CorrectedError

  export const AskInput = Request.partial({ id: true }).extend({
    ruleset: Ruleset,
    permissionMode: PermissionMode.optional(),
  })

  export const ReplyInput = z.object({
    requestID: PermissionID.zod,
    reply: Reply,
    message: z.string().optional(),
  })

  export interface Interface {
    readonly ask: (input: z.infer<typeof AskInput>) => Effect.Effect<void, Error>
    readonly reply: (input: z.infer<typeof ReplyInput>) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
  }

  interface PendingEntry {
    info: Request
    deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
  }

  interface State {
    pending: Map<PermissionID, PendingEntry>
    approved: Ruleset
  }

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    log.info("evaluate", { permission, pattern, ruleset: rulesets.flat() })
    return evalRule(permission, pattern, ...rulesets)
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Permission") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("Permission.state")(function* (ctx) {
          const row = Database.use((db) =>
            db.select().from(PermissionTable).where(eq(PermissionTable.project_id, ctx.project.id)).get(),
          )
          const state = {
            pending: new Map<PermissionID, PendingEntry>(),
            approved: row?.data ?? [],
          }

          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              for (const item of state.pending.values()) {
                yield* Deferred.fail(item.deferred, new RejectedError())
              }
              state.pending.clear()
            }),
          )

          return state
        }),
      )

      const ask = Effect.fn("Permission.ask")(function* (input: z.infer<typeof AskInput>) {
        const { approved, pending } = yield* InstanceState.get(state)
        const { ruleset, permissionMode, ...request } = input

        // Use the provided permission mode or default
        const mode: PermissionMode = permissionMode ?? DEFAULT_PERMISSION_MODE

        // Check mode-based auto-approval/denial
        for (const pattern of request.patterns) {
          const modeResult = evaluatePermissionForMode(request.permission, mode)
          if (modeResult.action === "deny") {
            log.info("denied by mode", {
              permission: request.permission,
              pattern,
              mode,
              reason: modeResult.reason,
            })
            return yield* new DeniedError({
              ruleset: [{ permission: request.permission, pattern, action: "deny" }],
            })
          }
          if (modeResult.action === "allow") {
            log.info("auto-approved by mode", {
              permission: request.permission,
              pattern,
              mode,
              reason: modeResult.reason,
            })
            continue
          }
        }

        // Now evaluate rules
        let needsAsk = false

        for (const pattern of request.patterns) {
          const rule = evaluate(request.permission, pattern, ruleset, approved)
          log.info("evaluated", { permission: request.permission, pattern, action: rule })
          if (rule.action === "deny") {
            return yield* new DeniedError({
              ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
            })
          }
          if (rule.action === "allow") continue
          needsAsk = true
        }

        if (!needsAsk) return

        const id = request.id ?? PermissionID.ascending()
        const info: Request = {
          id,
          ...request,
        }
        log.info("asking", { id, permission: info.permission, patterns: info.patterns })

        const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
        pending.set(id, { info, deferred })
        void Bus.publish(Event.Asked, info)
        return yield* Effect.ensuring(
          Deferred.await(deferred),
          Effect.sync(() => {
            pending.delete(id)
          }),
        )
      })

      const reply = Effect.fn("Permission.reply")(function* (input: z.infer<typeof ReplyInput>) {
        const { approved, pending } = yield* InstanceState.get(state)
        const existing = pending.get(input.requestID)
        if (!existing) return

        pending.delete(input.requestID)
        void Bus.publish(Event.Replied, {
          sessionID: existing.info.sessionID,
          requestID: existing.info.id,
          reply: input.reply,
        })

        if (input.reply === "reject") {
          yield* Deferred.fail(
            existing.deferred,
            input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError(),
          )

          for (const [id, item] of pending.entries()) {
            if (item.info.sessionID !== existing.info.sessionID) continue
            pending.delete(id)
            void Bus.publish(Event.Replied, {
              sessionID: item.info.sessionID,
              requestID: item.info.id,
              reply: "reject",
            })
            yield* Deferred.fail(item.deferred, new RejectedError())
          }
          return
        }

        yield* Deferred.succeed(existing.deferred, undefined)
        if (input.reply === "once") return

        for (const pattern of existing.info.always) {
          approved.push({
            permission: existing.info.permission,
            pattern,
            action: "allow",
          })
        }

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          const ok = item.info.patterns.every(
            (pattern) => evaluate(item.info.permission, pattern, approved).action === "allow",
          )
          if (!ok) continue
          pending.delete(id)
          void Bus.publish(Event.Replied, {
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

  function expand(pattern: string): string {
    if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
    if (pattern === "~") return os.homedir()
    if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
    if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
    return pattern
  }

  export function fromConfig(permission: Config.Permission) {
    const ruleset: Ruleset = []
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

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat()
  }

  const EDIT_TOOLS = ["edit", "write", "apply_patch", "multiedit"]

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>()
    for (const tool of tools) {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      if (!rule) continue
      if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }

  /**
   * Check if a Bash permission rule is overly broad and would match dangerous patterns.
   * Returns warning information if the rule is dangerous, null otherwise.
   *
   * @param rule - The permission rule to check
   * @returns Warning information if dangerous, null if safe
   */
  export function isDangerousBashPermission(rule: Rule): { warning: string; severity: "warn" | "error" } | null {
    // Only check allow rules for bash permissions
    if (rule.action !== "allow") return null
    if (!Wildcard.match("bash", rule.permission)) return null

    // Check for COMPLETELY broad patterns like "*" or "* *"
    // These would match ALL commands including dangerous ones
    if (rule.pattern === "*" || rule.pattern === "") {
      return {
        warning:
          "This rule allows ALL bash commands without restriction, including dangerous ones. Consider using bypassPermissions mode instead.",
        severity: "warn",
      }
    }

    // Check for prefix patterns that match dangerous command categories
    // E.g., "python *", "node *", "sudo *"
    // Patterns are space-separated command prefixes like "git checkout *"
    const dangerousPrefixes: Array<{ prefixes: string[]; category: string }> = [
      { prefixes: ["python", "python3", "python2", "py"], category: "interpreter" },
      { prefixes: ["node", "nodejs"], category: "interpreter" },
      { prefixes: ["deno run", "deno eval"], category: "interpreter" },
      { prefixes: ["bun test", "bun build", "bun eval"], category: "interpreter" },
      { prefixes: ["ruby", "rbx", "jruby"], category: "interpreter" },
      { prefixes: ["perl", "perl5"], category: "interpreter" },
      { prefixes: ["php", "hhvm"], category: "interpreter" },
      { prefixes: ["lua", "lua5", "luajit"], category: "interpreter" },
      { prefixes: ["npx", "bunx"], category: "package-runner" },
      { prefixes: ["npm run", "npm exec", "npm start", "npm test", "npm build"], category: "package-runner" },
      { prefixes: ["yarn run", "yarn exec", "yarn start", "yarn test", "yarn build"], category: "package-runner" },
      { prefixes: ["pnpm run", "pnpm exec", "pnpm start", "pnpm test", "pnpm build"], category: "package-runner" },
      { prefixes: ["bun run", "bun start", "bun test", "bun build"], category: "package-runner" },
      { prefixes: ["bash -c", "sh -c", "zsh -c", "fish -c"], category: "shell-eval" },
      { prefixes: ["eval", "exec"], category: "shell-eval" },
      { prefixes: ["sudo", "su", "doas", "pkexec"], category: "privilege" },
      { prefixes: ["ssh", "scp", "rsync"], category: "network" },
      { prefixes: ["rm"], category: "filesystem" },
      { prefixes: ["dd"], category: "filesystem" },
      { prefixes: ["mkfs"], category: "filesystem" },
    ]

    for (const { prefixes, category } of dangerousPrefixes) {
      for (const prefix of prefixes) {
        // Build test commands that would match this prefix pattern
        // Pattern "python *" should match "python test"
        // Pattern "python install" should match "python install"
        const testCommand = `${prefix} test`
        if (Wildcard.match(testCommand, rule.pattern)) {
          return {
            warning: `This rule would allow '${prefix}' commands (${category} category) which can be dangerous. Consider being more specific.`,
            severity: "warn",
          }
        }
      }
    }

    return null
  }

  /**
   * Check all rules in a ruleset for dangerous permissions.
   * Returns array of warnings for rules that match dangerous patterns.
   */
  export function checkDangerousRules(
    ruleset: Ruleset,
  ): Array<{ rule: Rule; warning: string; severity: "warn" | "error" }> {
    const result: Array<{ rule: Rule; warning: string; severity: "warn" | "error" }> = []

    for (const rule of ruleset) {
      const check = isDangerousBashPermission(rule)
      if (check) {
        result.push({ rule, ...check })
      }
    }

    return result
  }

  export const defaultLayer = Layer.unwrap(Effect.sync(() => layer.pipe(Layer.provide(Session.defaultLayer))))

  export const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function ask(input: z.infer<typeof AskInput>) {
    return runPromise((s) => s.ask(input))
  }

  export async function reply(input: z.infer<typeof ReplyInput>) {
    return runPromise((s) => s.reply(input))
  }

  export async function list() {
    return runPromise((s) => s.list())
  }
}

export { PermissionModeService, evaluatePermissionForMode } from "./mode"
export { PermissionMode, getNextPermissionMode, DEFAULT_PERMISSION_MODE } from "./schema"
