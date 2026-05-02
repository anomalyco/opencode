import { Instance } from "../project/instance"
import { InstanceStore } from "../project/instance-store"
import { getBootstrapRunEffect } from "../effect/app-runtime"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: await getBootstrapRunEffect(),
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await InstanceStore.disposeInstance(Instance.current)
      }
    },
  })
}
