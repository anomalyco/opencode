export function createTaskbarAttentionRegistry() {
  const windows = new Map<number, Set<string>>()
  const viewed = new Map<string, Set<number>>()

  const sessions = () => {
    const result = new Set<string>()
    windows.forEach((items) => items.forEach((session) => result.add(session)))
    viewed.forEach((_, session) => result.delete(session))
    return result
  }

  const acknowledge = (windowID: number, items: ReadonlySet<string>) => {
    viewed.forEach((waiting, session) => {
      if (!items.has(session)) waiting.delete(windowID)
      if (waiting.size === 0) viewed.delete(session)
    })
  }

  const open = (windowID: number) => {
    if (windows.has(windowID)) return
    windows.set(windowID, new Set())
    viewed.forEach((waiting) => waiting.add(windowID))
  }

  return {
    open,
    set(windowID: number, items: readonly string[]) {
      const next = new Set(items)
      open(windowID)
      windows.set(windowID, next)
      const suppressed = [...viewed.keys()].filter((session) => next.has(session))
      acknowledge(windowID, next)
      return suppressed
    },
    viewed(session: string) {
      const waiting = new Set(windows.keys())
      windows.forEach((items) => items.delete(session))
      if (waiting.size) viewed.set(session, waiting)
    },
    close(windowID: number) {
      windows.delete(windowID)
      acknowledge(windowID, new Set())
    },
    sessions,
    count() {
      return sessions().size
    },
  }
}
