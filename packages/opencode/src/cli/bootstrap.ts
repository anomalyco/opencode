import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { HookService } from "../hook/service"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      // Initialize the native hook system
      HookService.getInstance()

      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}
