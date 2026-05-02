import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef } from "@/effect/instance-ref"
import { Effect } from "effect"
import { context } from "./instance-context"
import { InstanceStore } from "./instance-store"

export async function provide<R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }): Promise<R> {
  const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: input.directory })))
  if (input.init) await AppRuntime.runPromise(input.init.pipe(Effect.provideService(InstanceRef, ctx)))
  return context.provide(ctx, () => input.fn())
}

export * as WithInstance from "./with-instance"
