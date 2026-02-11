import { Instance } from "@/project/instance"

export namespace SessionFallback {
  export interface ModelRef {
    providerID: string
    modelID: string
  }

  const state = Instance.state(() => {
    const data: Record<string, number> = {}
    return data
  })

  function key(sessionID: string, agentName: string) {
    return `${sessionID}:${agentName}`
  }

  export function buildModelList(primary: ModelRef, fallbacks?: ModelRef[]): ModelRef[] {
    if (!fallbacks || fallbacks.length === 0) return [primary]
    const seen = new Set<string>()
    const result: ModelRef[] = []
    for (const ref of [primary, ...fallbacks]) {
      const key = `${ref.providerID}:${ref.modelID}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(ref)
    }
    return result
  }

  export function getStartIndex(sessionID: string, agentName: string): number {
    return state()[key(sessionID, agentName)] ?? 0
  }

  export function recordSuccess(sessionID: string, agentName: string, index: number) {
    state()[key(sessionID, agentName)] = index
  }

  /**
   * Returns the next model index to try, cycling through all models starting
   * from startIndex. Returns undefined when all models have been tried.
   */
  export function nextIndex(current: number, total: number, startIndex: number): number | undefined {
    const safe = startIndex >= total ? 0 : startIndex
    const next = (current + 1) % total
    if (next === safe) return undefined
    return next
  }
}
