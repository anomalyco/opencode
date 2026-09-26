import { createContext, useContext, createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSessionLayout } from "@/pages/session/session-layout"

interface SubAgentsContextValue {
  children: () => Session[]
  agentsBusy: () => boolean
  totalCost: () => number
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const SubAgentsContext = createContext<SubAgentsContextValue>()

export function SubAgentsProvider(props: { children: JSX.Element }) {
  const sync = useSync()
  const { params } = useSessionLayout()
  const sdk = useSDK()
  const serverSDK = useServerSDK()

  // One-shot backfill for subagents created before the live store's paginated fetch window
  // included them. Never invalidated - the live store below owns freshness.
  const backfillQuery = useQuery(() => ({
    queryKey: [serverSDK().scope, sdk().directory, "childSessions", params.id] as const,
    queryFn: async () => {
      const id = params.id
      if (!id) return []
      const resp = await sdk().client.session.list()
      const all = resp.data ?? []
      return all.filter((s) => s.parentID === id)
    },
    enabled: () => !!params.id,
    staleTime: Infinity,
  }))

  const children = createMemo(() => {
    const parentID = params.id
    if (!parentID) return []
    const merged = new Map((backfillQuery.data ?? []).map((s) => [s.id, s]))
    // The live store is fresher than the backfill snapshot, so it wins on conflict.
    sync()
      .data.session.filter((s) => s.parentID === parentID)
      .forEach((s) => merged.set(s.id, s))
    return [...merged.values()].sort((a, b) => cmp(a.id, b.id))
  })

  const totalCost = createMemo(() => {
    const parent = params.id ? sync().session.get(params.id) : undefined
    const parentCost = parent?.cost ?? 0
    const childCost = children().reduce((sum, s) => sum + (s.cost ?? 0), 0)
    return parentCost + childCost
  })

  const agentsBusy = createMemo(() => {
    const statuses = sync().data.session_status
    return children().some((s) => statuses[s.id]?.type === "busy")
  })

  const value: SubAgentsContextValue = {
    children,
    agentsBusy,
    totalCost,
  }

  return <SubAgentsContext.Provider value={value}>{props.children}</SubAgentsContext.Provider>
}

export function useSubAgents(): SubAgentsContextValue {
  const context = useContext(SubAgentsContext)
  if (!context) throw new Error("useSubAgents must be used within a SubAgentsProvider")
  return context
}
