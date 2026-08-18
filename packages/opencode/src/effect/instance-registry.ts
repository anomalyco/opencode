import type { InstanceContext } from "@/project/instance-context"

const disposers = new Set<(ctx: InstanceContext) => Promise<void>>()

export function registerDisposer(disposer: (ctx: InstanceContext) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(ctx: InstanceContext) {
  await Promise.allSettled([...disposers].map((disposer) => disposer(ctx)))
}
