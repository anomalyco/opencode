import { AppRuntime } from "@/effect/app-runtime"
import { context, type InstanceContext } from "./instance-context"
import { InstanceStore } from "./instance-store"

export async function provide<R>(input: { directory: string; fn: (ctx: InstanceContext) => R }): Promise<R> {
  const ctx = await AppRuntime.runPromise(
    InstanceStore.Service.use((store) => store.load({ directory: input.directory })),
  )
  return context.provide(ctx, () => input.fn(ctx))
}

export * as WithInstance from "./with-instance"
