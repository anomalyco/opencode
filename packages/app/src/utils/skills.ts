import { useSDK } from "@/context/sdk"

export type SkillInfo = {
  name: string
  description: string
  location: string
  content: string
}

const cache = new Map<string, SkillInfo[]>()
const wait = new Map<string, Promise<SkillInfo[]>>()

export function cachedSkills(dir: string) {
  return cache.get(dir)
}

export async function loadSkills(sdk: ReturnType<typeof useSDK>) {
  const dir = sdk.directory
  const hit = cache.get(dir)
  if (hit) return hit

  const task = wait.get(dir)
  if (task) return task

  console.debug("[skills] load.start", { dir })
  const job = sdk.client.app
    .skills({}, { throwOnError: true })
    .then((resp) => {
      const list = resp.data ?? []
      console.debug("[skills] load.done", { dir, count: list.length })
      cache.set(dir, list)
      wait.delete(dir)
      return list
    })
    .catch((err) => {
      console.debug("[skills] load.fail", {
        dir,
        err: err instanceof Error ? err.message : String(err),
      })
      wait.delete(dir)
      throw err
    })

  wait.set(dir, job)
  return job
}
