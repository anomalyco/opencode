import { normalizeServerUrl, ServerConnection } from "@/runtime/server/registry"
import type { ServerHealth } from "@/runtime/server/health"

export type ServerFormValues = {
  url: string
  name: string
  password: string
}

export function createServerHealthPreview(
  check: (server: ServerConnection.HttpBase) => Promise<Pick<ServerHealth, "healthy">>,
) {
  let generation = 0

  const cancel = () => {
    generation += 1
  }

  const preview = async (values: ServerFormValues, setStatus: (value: boolean | undefined) => void) => {
    const current = ++generation
    setStatus(undefined)
    const normalized = normalizeServerUrl(values.url)
    if (!normalized) return
    const host = normalized.replace(/^https?:\/\//, "").split("/")[0]
    if (!host) return
    if (!host.includes("localhost") && !host.startsWith("127.0.0.1") && !host.includes(".") && !host.includes(":"))
      return

    const http: ServerConnection.HttpBase = { url: normalized }
    if (values.password) http.password = values.password
    const result = await check(http)
    if (current !== generation) return
    setStatus(result.healthy)
  }

  return { cancel, preview }
}

export function replaceServerConnection(
  originalKey: ServerConnection.Key,
  next: ServerConnection.Http,
  operations: {
    removeTabs: (key: ServerConnection.Key) => void
    add: (server: ServerConnection.Http) => ServerConnection.Any | undefined
    remove: (key: ServerConnection.Key) => void
  },
) {
  operations.removeTabs(originalKey)
  const added = operations.add(next)
  if (!added) return
  operations.remove(originalKey)
}
