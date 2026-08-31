import { Effect } from "effect"
import { OpenCode as EffectOpenCode, type AppApi as EffectApi } from "../src/effect"
import type { Session } from "@opencode-ai/schema/session"
import type { DiscoverOptions } from "../src/service"

type EffectClient = Effect.Success<ReturnType<typeof EffectOpenCode.make>>
type PromiseClient = ReturnType<typeof import("../src/promise").OpenCode.make>

declare const effectClient: EffectClient
declare const promiseClient: PromiseClient

const exactVersion: DiscoverOptions = { version: "2.0.0" }
const compatibleVersion: DiscoverOptions = { version: (version) => version.startsWith("2.") }

const effectApi: EffectApi<unknown> = effectClient

const effectSession: Effect.Effect<Session.Info, unknown> = effectClient.session.get({
  sessionID: "ses_test" as Session.ID,
})

declare const sessionID: Parameters<typeof effectApi.session.instructions.entry.list>[0]["sessionID"]

const effectList: Effect.Effect<
  ReadonlyArray<{ readonly key: string; readonly value: unknown }>,
  unknown
> = effectApi.session.instructions.entry.list({ sessionID })
const effectPut: Effect.Effect<void, unknown> = effectApi.session.instructions.entry.put({
  sessionID,
  key: "review-notes",
  value: { text: "Check the diff" },
})
const effectRemove: Effect.Effect<void, unknown> = effectApi.session.instructions.entry.remove({
  sessionID,
  key: "review-notes",
})

const promiseList: Promise<ReadonlyArray<{ readonly key: string; readonly value: unknown }>> =
  promiseClient.session.instructions.entry.list({ sessionID: "ses_test" })
const promisePut: Promise<void> = promiseClient.session.instructions.entry.put({
  sessionID: "ses_test",
  key: "review-notes",
  value: { text: "Check the diff" },
})
const promiseRemove: Promise<void> = promiseClient.session.instructions.entry.remove({
  sessionID: "ses_test",
  key: "review-notes",
})
const emptyRpcOutput: Awaited<ReturnType<typeof promiseClient.rpc.call>> = {}

void [
  effectSession,
  effectList,
  effectPut,
  effectRemove,
  promiseList,
  promisePut,
  promiseRemove,
  emptyRpcOutput,
  exactVersion,
  compatibleVersion,
]
