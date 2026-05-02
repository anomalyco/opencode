import { Instance } from "../project/instance"
import { InstanceRuntime } from "../project/instance-runtime"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await InstanceRuntime.disposeInstance(Instance.current)
      }
    },
  })
}
