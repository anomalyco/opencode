import { createMemo } from "solid-js"
import { useData } from "../context/data"
import { hasConnectedProvider } from "../util/connected-provider"

export function useConnected() {
  const data = useData()
  return createMemo(() => hasConnectedProvider(data.location.integration.list() ?? []))
}
