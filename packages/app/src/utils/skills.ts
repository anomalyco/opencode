import { useSDK } from "@/context/sdk"

export type SkillInfo = {
  name: string
  description?: string
  location: string
  content: string
}

const cache = new Map<string, SkillInfo[]>()
const wait = new Map<string, Promise<SkillInfo[]>>()
const client = new WeakMap<object, number>()
let next = 0

function cid(value: object) {
  const hit = client.get(value)
  if (hit !== undefined) return hit
  const id = ++next
  client.set(value, id)
  return id
}

function key(sdk: ReturnType<typeof useSDK>) {
  return `${sdk.directory}\n${cid(sdk.client)}`
}

export function cachedSkills(sdk: ReturnType<typeof useSDK>) {
  return cache.get(key(sdk))
}

export async function loadSkills(sdk: ReturnType<typeof useSDK>) {
  const id = key(sdk)
  const hit = cache.get(id)
  if (hit) return hit

  const task = wait.get(id)
  if (task) return task

  const job = sdk.client.app
    .skills({}, { throwOnError: true })
    .then((resp) => {
      const list = resp.data ?? []
      cache.set(id, list)
      wait.delete(id)
      return list
    })
    .catch((err) => {
      wait.delete(id)
      throw err
    })

  wait.set(id, job)
  return job
}
