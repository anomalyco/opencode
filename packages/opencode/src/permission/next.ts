import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import z from "zod"

export namespace PermissionNext {
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

  export const Source = z.enum(["default", "global", "project", "session"]).meta({
    ref: "PermissionSource",
  })
  export type Source = z.infer<typeof Source>

  export const RuleWithSource = Rule.extend({
    source: Source,
    readonly: z.boolean(),
  }).meta({
    ref: "PermissionRuleWithSource",
  })
  export type RuleWithSource = z.infer<typeof RuleWithSource>

  export const RulesetWithSource = RuleWithSource.array().meta({
    ref: "PermissionRulesetWithSource",
  })
  export type RulesetWithSource = z.infer<typeof RulesetWithSource>

  export function fromConfig(permission: Config.Permission) {
    const ruleset: Ruleset = []
    for (const [key, value] of Object.entries(permission)) {
      if (typeof value === "string") {
        ruleset.push({
          permission: key,
          action: value,
          pattern: "*",
        })
        continue
      }
      ruleset.push(...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern, action })))
    }
    return ruleset
  }

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat()
  }

  export const Request = z
    .object({
      id: Identifier.schema("permission"),
      sessionID: Identifier.schema("session"),
      permission: z.string(),
      patterns: z.string().array(),
      metadata: z.record(z.string(), z.any()),
      always: z.string().array(),
      tool: z
        .object({
          messageID: z.string(),
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
    projectID: z.string(),
    patterns: z.string().array(),
  })

  export const Event = {
    Asked: BusEvent.define("permission.asked", Request),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        reply: Reply,
      }),
    ),
  }

  const state = Instance.state(async () => {
    const projectID = Instance.project.id
    const stored = await Storage.read<Ruleset>(["permission", projectID]).catch(() => [] as Ruleset)

    const pending: Record<
      string,
      {
        info: Request
        resolve: () => void
        reject: (e: any) => void
      }
    > = {}

    return {
      pending,
      approved: stored,
    }
  })

  export const ask = fn(
    Request.partial({ id: true }).extend({
      ruleset: Ruleset,
    }),
    async (input) => {
      const s = await state()
      const { ruleset, ...request } = input
      for (const pattern of request.patterns ?? []) {
        const rule = evaluate(request.permission, pattern, ruleset, s.approved)
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny")
          throw new DeniedError(ruleset.filter((r) => Wildcard.match(request.permission, r.permission)))
        if (rule.action === "ask") {
          const id = input.id ?? Identifier.ascending("permission")
          return new Promise<void>((resolve, reject) => {
            const info: Request = {
              id,
              ...request,
            }
            s.pending[id] = {
              info,
              resolve,
              reject,
            }
            Bus.publish(Event.Asked, info)
          })
        }
        if (rule.action === "allow") continue
      }
    },
  )

  export const reply = fn(
    z.object({
      requestID: Identifier.schema("permission"),
      reply: Reply,
      message: z.string().optional(),
    }),
    async (input) => {
      const s = await state()
      const existing = s.pending[input.requestID]
      if (!existing) return
      delete s.pending[input.requestID]
      Bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })
      if (input.reply === "reject") {
        existing.reject(input.message ? new CorrectedError(input.message) : new RejectedError())
        // Reject all other pending permissions for this session
        const sessionID = existing.info.sessionID
        for (const [id, pending] of Object.entries(s.pending)) {
          if (pending.info.sessionID === sessionID) {
            delete s.pending[id]
            Bus.publish(Event.Replied, {
              sessionID: pending.info.sessionID,
              requestID: pending.info.id,
              reply: "reject",
            })
            pending.reject(new RejectedError())
          }
        }
        return
      }
      if (input.reply === "once") {
        existing.resolve()
        return
      }
      if (input.reply === "always") {
        for (const pattern of existing.info.always) {
          s.approved.push({
            permission: existing.info.permission,
            pattern,
            action: "allow",
          })
        }
        log.info("approved permission", {
          permission: existing.info.permission,
          patterns: existing.info.always,
          total: s.approved.length,
        })

        existing.resolve()

        const sessionID = existing.info.sessionID
        for (const [id, pending] of Object.entries(s.pending)) {
          if (pending.info.sessionID !== sessionID) continue
          const ok = pending.info.patterns.every(
            (pattern) => evaluate(pending.info.permission, pattern, s.approved).action === "allow",
          )
          if (!ok) continue
          delete s.pending[id]
          Bus.publish(Event.Replied, {
            sessionID: pending.info.sessionID,
            requestID: pending.info.id,
            reply: "always",
          })
          pending.resolve()
        }

        // TODO: we don't save the permission ruleset to disk yet until there's
        // UI to manage it
        // await Storage.write(["permission", Instance.project.id], s.approved)
        return
      }
    },
  )

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    const merged = merge(...rulesets)
    log.info("evaluate", { permission, pattern, ruleset: merged })
    const match = merged.findLast(
      (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
    )
    return match ?? { action: "ask", permission, pattern: "*" }
  }

  const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>()
    for (const tool of tools) {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool

      const rule = ruleset.findLast((r) => Wildcard.match(permission, r.permission))
      if (!rule) continue
      if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }

  /** User rejected without message - halts execution */
  export class RejectedError extends Error {
    constructor() {
      super(`The user rejected permission to use this specific tool call.`)
    }
  }

  /** User rejected with message - continues with guidance */
  export class CorrectedError extends Error {
    constructor(message: string) {
      super(`The user rejected permission to use this specific tool call with the following feedback: ${message}`)
    }
  }

  /** Auto-rejected by config rule - halts execution */
  export class DeniedError extends Error {
    constructor(public readonly ruleset: Ruleset) {
      super(
        `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(ruleset)}`,
      )
    }
  }

  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }

  export async function approved() {
    const s = await state()
    log.info("getting approved permissions", { count: s.approved.length, rules: s.approved })
    return s.approved
  }

  export async function all(agent?: string): Promise<RulesetWithSource> {
    // Load configs separately to avoid automatic merging
    const { Filesystem } = await import("@/util/filesystem")
    const { Instance } = await import("@/project/instance")
    const path = await import("path")

    const [globalConfig, projectConfigFiles, sessionRules] = await Promise.all([
      Config.global(),
      Filesystem.findUp("opencode.json", Instance.directory, Instance.worktree),
      approved(),
    ])

    // Load project config file directly (without global merged in)
    let projectConfig: Config.Info | undefined
    if (projectConfigFiles.length > 0) {
      try {
        const content = await Bun.file(projectConfigFiles[0]).text()
        projectConfig = JSON.parse(content)
      } catch (e) {
        // Ignore if file doesn't exist or is invalid
      }
    }

    const result: RulesetWithSource = []

    // Build agent defaults manually (without user config)
    if (agent) {
      const { Truncate } = await import("@/tool/truncation")
      const defaults = fromConfig({
        "*": "allow",
        doom_loop: "ask",
        external_directory: {
          "*": "ask",
          [Truncate.DIR]: "allow",
          [Truncate.GLOB]: "allow",
        },
        question: "deny",
        plan_enter: "deny",
        plan_exit: "deny",
        read: {
          "*": "allow",
          "*.env": "ask",
          "*.env.*": "ask",
          "*.env.example": "allow",
        },
      })

      // Add agent-specific overrides
      const agentOverrides: Record<string, any> = {
        build: {
          question: "allow",
          plan_enter: "allow",
        },
        plan: {
          question: "allow",
          plan_exit: "allow",
        },
        general: {
          todoread: "deny",
          todowrite: "deny",
        },
        explore: {
          "*": "deny",
          grep: "allow",
          glob: "allow",
          list: "allow",
          bash: "allow",
          read: "allow",
        },
      }

      for (const rule of defaults) {
        result.push({ ...rule, source: "default", readonly: true })
      }

      if (agentOverrides[agent]) {
        for (const rule of fromConfig(agentOverrides[agent])) {
          result.push({ ...rule, source: "default", readonly: true })
        }
      }
    }

    // Add global config rules
    if (globalConfig.permission) {
      for (const rule of fromConfig(globalConfig.permission)) {
        result.push({ ...rule, source: "global", readonly: true })
      }
    }

    // Add project config rules
    if (projectConfig?.permission) {
      for (const rule of fromConfig(projectConfig.permission)) {
        result.push({ ...rule, source: "project", readonly: true })
      }
    }

    // Add session rules (editable)
    for (const rule of sessionRules) {
      result.push({ ...rule, source: "session", readonly: false })
    }

    return result
  }

  export async function remove(rule: Rule) {
    const s = await state()
    const index = s.approved.findIndex(
      (r) => r.permission === rule.permission && r.pattern === rule.pattern && r.action === rule.action,
    )
    if (index !== -1) {
      s.approved.splice(index, 1)
      log.info("removed permission", { rule, remaining: s.approved.length })
    }
  }

  export async function update(oldRule: Rule, newRule: Rule) {
    const s = await state()
    const index = s.approved.findIndex(
      (r) => r.permission === oldRule.permission && r.pattern === oldRule.pattern && r.action === oldRule.action,
    )
    if (index !== -1) {
      s.approved[index] = newRule
      log.info("updated permission", { oldRule, newRule })
    }
  }

  export async function add(rule: Rule) {
    const s = await state()
    s.approved.push(rule)
    log.info("added permission", { rule, total: s.approved.length })
  }
}
