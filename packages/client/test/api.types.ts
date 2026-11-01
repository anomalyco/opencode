import { Effect, Schema } from "effect"
import { OpenCode as EffectOpenCode, type AppApi as EffectApi } from "../src/effect"
import { Rpc } from "@opencode/schema/rpc"
import type { Session } from "@opencode/schema/session"
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

declare const sessionID: Parameters<typeof effectApi.experimental.session.instructions.entry.list>[0]["sessionID"]

const effectList: Effect.Effect<
  ReadonlyArray<{ readonly key: string; readonly value: unknown }>,
  unknown
> = effectApi.experimental.session.instructions.entry.list({ sessionID })
const effectPut: Effect.Effect<void, unknown> = effectApi.experimental.session.instructions.entry.put({
  sessionID,
  key: "review-notes",
  value: { text: "Check the diff" },
})
const effectRemove: Effect.Effect<void, unknown> = effectApi.experimental.session.instructions.entry.remove({
  sessionID,
  key: "review-notes",
})

const promiseList: Promise<ReadonlyArray<{ readonly key: string; readonly value: unknown }>> =
  promiseClient.experimental.session.instructions.entry.list({ sessionID: "ses_test" })
const promisePut: Promise<void> = promiseClient.experimental.session.instructions.entry.put({
  sessionID: "ses_test",
  key: "review-notes",
  value: { text: "Check the diff" },
})
const promiseRemove: Promise<void> = promiseClient.experimental.session.instructions.entry.remove({
  sessionID: "ses_test",
  key: "review-notes",
})

const OneSidedRpc = Rpc.define({
  id: "one-sided",
  methods: {
    status: { output: Schema.toStandardSchemaV1(Schema.Struct({ ok: Schema.Boolean })) },
    reset: {},
  },
})

const effectRpcStatus: Effect.Effect<{ readonly ok: boolean }, unknown> = effectClient.rpc(OneSidedRpc).status()
const effectRpcReset: Effect.Effect<void, unknown> = effectClient.rpc(OneSidedRpc).reset()
const promiseRpcStatus: Promise<{ readonly ok: boolean }> = promiseClient.rpc(OneSidedRpc).status()
const promiseRpcReset: Promise<void> = promiseClient.rpc(OneSidedRpc).reset()

// @ts-expect-error Input-less RPC methods reject arguments on Effect clients.
effectClient.rpc(OneSidedRpc).status({})
// @ts-expect-error Input-less RPC methods reject arguments on Promise clients.
void promiseClient.rpc(OneSidedRpc).status({})
// @ts-expect-error RPC definitions without events reject subscriptions.
effectClient.rpc(OneSidedRpc).events.subscribe("updated")
// @ts-expect-error RPC definitions without events reject listeners.
promiseClient.rpc(OneSidedRpc).events.on("updated", () => {})

void [
  effectSession,
  effectList,
  effectPut,
  effectRemove,
  promiseList,
  promisePut,
  promiseRemove,
  effectRpcStatus,
  effectRpcReset,
  promiseRpcStatus,
  promiseRpcReset,
  exactVersion,
  compatibleVersion,
]
