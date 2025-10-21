import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      const result = await cb()
      await Instance.dispose()
      return result
    },
  })
}
