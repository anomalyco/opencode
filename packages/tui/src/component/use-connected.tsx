import { createMemo } from "solid-js"
import { useData } from "../context/data"
import { hasConnectedProvider } from "../util/connected-provider"

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some(
      (provider) => provider.id !== "bolt" || Object.values(provider.models).some((model) => model.cost?.input !== 0),
    ),
  )
}
