import { runPromiseInstance } from "@/effect/runtime"
import { fn } from "@/util/fn"
import z from "zod"
import * as Mod from "./service"

const list = async (): Promise<Mod.Permission.Request[]> => {
  return runPromiseInstance(Mod.Permission.Service.use((s) => s.list()))
}

export const PermissionNext = {
  Action: Mod.Permission.Action,
  Rule: Mod.Permission.Rule,
  Ruleset: Mod.Permission.Ruleset,
  Request: Mod.Permission.Request,
  Reply: Mod.Permission.Reply,
  Approval: Mod.Permission.Approval,
  Event: Mod.Permission.Event,
  RejectedError: Mod.Permission.RejectedError,
  CorrectedError: Mod.Permission.CorrectedError,
  DeniedError: Mod.Permission.DeniedError,
  AskInput: Mod.Permission.AskInput,
  ReplyInput: Mod.Permission.ReplyInput,
  Service: Mod.Permission.Service,
  layer: Mod.Permission.layer,
  evaluate: Mod.Permission.evaluate,
  fromConfig: Mod.Permission.fromConfig,
  merge: Mod.Permission.merge,
  disabled: Mod.Permission.disabled,
  ask: fn(
    Mod.Permission.AskInput,
    async (input: z.infer<typeof Mod.Permission.AskInput>): Promise<void> =>
      runPromiseInstance(Mod.Permission.Service.use((s) => s.ask(input))),
  ),
  reply: fn(
    Mod.Permission.ReplyInput,
    async (input: z.infer<typeof Mod.Permission.ReplyInput>): Promise<void> =>
      runPromiseInstance(Mod.Permission.Service.use((s) => s.reply(input))),
  ),
  list,
}

export namespace PermissionNext {
  export type Action = Mod.Permission.Action
  export type Rule = Mod.Permission.Rule
  export type Ruleset = Mod.Permission.Ruleset
  export type Request = Mod.Permission.Request
  export type Reply = Mod.Permission.Reply
  export type Approval = z.infer<typeof Mod.Permission.Approval>
  export type Error = Mod.Permission.Error
  export type Interface = Mod.Permission.Interface
}
