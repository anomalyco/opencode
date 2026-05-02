import { Instance } from "../project/instance"
import { InstanceStore } from "../project/instance-store"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await InstanceStore.runtime.runPromise((s) => s.dispose(Instance.current))
      }
    },
  })
}
