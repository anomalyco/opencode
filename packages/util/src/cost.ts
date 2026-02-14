export interface CostMessage {
  id: string
  role: string
  cost?: number
}

export interface CostPart {
  type: string
  tool?: string
  state?: Record<string, unknown>
}

export interface CostStore {
  message: Record<string, CostMessage[] | undefined>
  part: Record<string, CostPart[] | undefined>
}

export function costs(id: string, store: CostStore) {
  const missing: string[] = []
  const visited = new Set<string>()

  const walk = (sid: string): number => {
    if (visited.has(sid)) return 0
    visited.add(sid)

    const messages = store.message[sid]
    if (!messages) {
      missing.push(sid)
      return 0
    }

    return messages
      .filter((msg) => msg.role === "assistant")
      .reduce((sum, msg) => {
        const parts = store.part[msg.id] ?? []
        const subCosts = parts
          .filter((part) => part.type === "tool" && part.tool === "task")
          .map((part) => (part.state?.metadata as Record<string, unknown> | undefined)?.sessionId)
          .filter((child): child is string => typeof child === "string")
          .reduce((acc, child) => acc + walk(child), 0)
        return sum + (msg.cost ?? 0) + subCosts
      }, 0)
  }

  const own = (store.message[id] ?? [])
    .filter((msg) => msg.role === "assistant")
    .reduce((sum, msg) => sum + (msg.cost ?? 0), 0)

  const total = walk(id)

  return { own, total, missing }
}
