import { Effect } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { getAdapter } from "./adapters"
import type { WorkspaceAdapter, WorkspaceInfo } from "./types"

const context = Effect.gen(function* () {
  return {
    instance: yield* InstanceRef,
    workspaceID: yield* WorkspaceRef,
  }
})

export const target = (info: WorkspaceInfo) =>
  Effect.gen(function* () {
    const adapter = getAdapter(info.projectID, info.type)
    const ctx = yield* context
    return yield* EffectBridge.fromPromise(() => adapter.target(info, ctx))
  })

export const configure = (adapter: WorkspaceAdapter, info: WorkspaceInfo) =>
  Effect.gen(function* () {
    const ctx = yield* context
    return yield* EffectBridge.fromPromise(() => adapter.configure(info, ctx))
  })

export const create = (
  adapter: WorkspaceAdapter,
  info: WorkspaceInfo,
  env: Record<string, string | undefined>,
  from?: WorkspaceInfo,
) =>
  Effect.gen(function* () {
    const ctx = yield* context
    return yield* EffectBridge.fromPromise(() => adapter.create(info, env, from, ctx))
  })

export const list = (adapter: WorkspaceAdapter) =>
  Effect.gen(function* () {
    const ctx = yield* context
    return yield* EffectBridge.fromPromise(() => Promise.resolve(adapter.list?.(ctx) ?? []))
  })

export const remove = (info: WorkspaceInfo) =>
  Effect.gen(function* () {
    const adapter = getAdapter(info.projectID, info.type)
    const ctx = yield* context
    return yield* EffectBridge.fromPromise(() => adapter.remove(info, ctx))
  })

export * as WorkspaceAdapterRuntime from "./workspace-adapter-runtime"
