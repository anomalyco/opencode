import { createMemo } from "solid-js"
import { useData } from "../context/data"

export function useConnected() {
  const data = useData()
  return createMemo(() => (data.location.provider.list() ?? []).some((provider) => provider.enabled !== false))
}
