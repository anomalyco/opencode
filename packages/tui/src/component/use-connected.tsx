import { createMemo } from "solid-js"
import { useSync } from "../context/sync"

export function providersConnected(
  providers: { id: string; models: Record<string, { cost?: { input?: number } }> }[],
) {
  return providers.some(
    (provider) =>
      provider.id !== "opencode" || Object.values(provider.models).some((model) => model.cost?.input !== 0),
  )
}

export function connectedForStatus(
  status: "loading" | "partial" | "complete",
  providers: { id: string; models: Record<string, { cost?: { input?: number } }> }[],
) {
  return status === "loading" || providersConnected(providers)
}

export function useConnected() {
  const sync = useSync()
  return createMemo(() => connectedForStatus(sync.status, sync.data.provider))
}
