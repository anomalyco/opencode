import { AppRuntime } from "@/effect/app-runtime"
import { context } from "./instance-context"
import { InstanceStore } from "./instance-store"

export async function provide<R>(input: { directory: string; fn: () => R }): Promise<R> {
  const ctx = await AppRuntime.runPromise(
    InstanceStore.Service.use((store) => store.load({ directory: input.directory })),
  )
  return context.provide(ctx, () => input.fn())
}

export * as WithInstance from "./with-instance"
