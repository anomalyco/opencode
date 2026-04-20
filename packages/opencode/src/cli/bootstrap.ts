import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { ProjectID } from "../project/schema"

function localProject(directory: string): Project.Info & { vcs: "git" | undefined } {
  const now = Date.now()
  return {
    id: ProjectID.make(directory),
    time: {
      created: now,
      updated: now,
    },
    vcs: "git" as const,
  }
}

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    project: localProject(directory),
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
