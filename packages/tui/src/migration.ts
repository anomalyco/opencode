import type { OpenCodeClient } from "@opencode-ai/client"

type Client = Pick<OpenCodeClient, "migration">
export type Status = Awaited<ReturnType<Client["migration"]["v1"]["status"]>>

export async function run(client: Client, update: (status: Status) => void, signal?: AbortSignal) {
  const initial = await client.migration.v1.status({ signal })
  if (initial.status === "completed") return false
  update(initial)

  let polling = false
  const progress = setInterval(() => {
    if (polling) return
    polling = true
    void client.migration.v1
      .status({ signal })
      .then(update)
      .catch(() => {})
      .finally(() => {
        polling = false
      })
  }, 1_000)

  try {
    await client.migration.v1.run({ signal })
    update(await client.migration.v1.status({ signal }))
    return true
  } finally {
    clearInterval(progress)
  }
}

export * as Migration from "./migration"
