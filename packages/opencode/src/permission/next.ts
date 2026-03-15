import { runtime } from "@/effect/runtime"
import { Config } from "@/config/config"
import { fn } from "@/util/fn"
import { Wildcard } from "@/util/wildcard"
import { Effect } from "effect"
import os from "os"
import * as S from "./service"
import type {
  Action as ActionType,
  PermissionError,
  Reply as ReplyType,
  Request as RequestType,
  Rule as RuleType,
  Ruleset as RulesetType,
} from "./service"

export namespace PermissionNext {
  function expand(pattern: string): string {
    if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
    if (pattern === "~") return os.homedir()
    if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
    if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
    return pattern
  }

  function runPromise<A>(f: (service: S.PermissionService.Api) => Effect.Effect<A, PermissionError>) {
    return runtime.runPromise(S.PermissionService.use(f))
  }

  export const Action = S.Action
  export type Action = ActionType
  export const Rule = S.Rule
  export type Rule = RuleType
  export const Ruleset = S.Ruleset
  export type Ruleset = RulesetType
  export const Request = S.Request
  export type Request = RequestType
  export const Reply = S.Reply
  export type Reply = ReplyType
  export const Approval = S.Approval
  export const Event = S.Event
  export const Service = S.PermissionService
  export const RejectedError = S.RejectedError
  export const CorrectedError = S.CorrectedError
  export const DeniedError = S.DeniedError

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
      ruleset.push(
        ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
      )
    }
    return ruleset
  }

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat()
  }

  export const ask = fn(S.AskInput, async (input) => runPromise((service) => service.ask(input)))

  export const reply = fn(S.ReplyInput, async (input) => runPromise((service) => service.reply(input)))

  export async function list() {
    return runPromise((service) => service.list())
  }

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    return S.evaluate(permission, pattern, ...rulesets)
  }

  const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

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
}
