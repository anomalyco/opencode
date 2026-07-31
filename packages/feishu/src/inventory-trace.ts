export type InventoryTraceEvent = {
  traceID: string
  conversationID: string
  messageID: string
  type:
    | "inventory_intent_admitted"
    | "inventory_query_started"
    | "inventory_query_completed"
    | "inventory_query_failed"
    | "inventory_answer_mapped"
    | "inventory_answer_delivered"
    | "inventory_operation_blocked"
    | "inventory_correction"
  occurredAt: number
  relatedEventID?: string
  data: Record<string, string | number | boolean | readonly string[]>
}

export type InventoryTraceSink = {
  append(event: InventoryTraceEvent): void | Promise<void>
}

const forbiddenKeys = new Set(["password", "passwordfile", "connectionstring", "reasoning"])
const secretValue = /password\s*=|mysql:\/\/|[\\/](?:secrets?)[\\/]/i

export function createInventoryTrace(sink: InventoryTraceSink) {
  return {
    async append(event: InventoryTraceEvent) {
      const entries = Object.entries(event.data)
      entries.forEach(([, value]) => {
        if (typeof value === "string" || typeof value === "boolean") return
        if (typeof value === "number" && Number.isFinite(value)) return
        if (Array.isArray(value) && value.every((item) => typeof item === "string")) return
        throw new Error("inventory trace data invalid")
      })
      const data = Object.fromEntries(
        entries.flatMap(([key, value]) => {
          if (forbiddenKeys.has(key.toLowerCase())) return []
          if (typeof value === "string" && secretValue.test(value)) return []
          return [[key, Array.isArray(value) ? [...value] : value]]
        }),
      )

      await sink.append({
        ...event,
        data,
      })
    },
  }
}
