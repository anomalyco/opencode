import { createMemo, type Accessor } from "solid-js"
import { useData, useServer } from "@/runtime/server/current"
import { summaryStatus } from "./indicator"

export function useSummaryStatus(directory: Accessor<string | undefined>) {
  const data = useData()
  const server = useServer()
  const mcp = () => {
    const value = directory()
    if (!value) return
    return data.location.mcp.server.list({ directory: value })
  }
  return createMemo(() => {
    const health = server.health?.healthy
    const servers = mcp()
    return summaryStatus({
      ready: health === false || servers !== undefined,
      serverHealth: health,
      mcp: (servers ?? []).map((item) => item.status.status),
      connecting: server.ctx.sdk.connection.status() !== "connected",
    })
  })
}
