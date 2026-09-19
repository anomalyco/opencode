import { InstanceRuntime } from "../project/instance-runtime"
import { context, type InstanceContext } from "../project/instance-context"

export async function bootstrap<T>(directory: string, cb: (ctx: InstanceContext) => Promise<T>) {
  const ctx = await InstanceRuntime.load({ directory })
  try {
    return await context.provide(ctx, () => cb(ctx))
  } finally {
    await InstanceRuntime.disposeInstance(ctx)
  }
}
