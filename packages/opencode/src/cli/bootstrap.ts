import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { localProject } from "../project/local-project"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  const project = localProject(directory)
  return Instance.provide({
    project,
    init: InstanceBootstrap,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}
