import { Instance } from "../project/instance"
import { InstanceRuntime } from "../project/instance-runtime"
import { WithInstance } from "../project/with-instance"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return WithInstance.provide({
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
