export function initializationData<A>(state: (() => A | undefined) & { error: unknown }) {
  if (state.error !== undefined) throw markLocalServerStartup(state.error)
  return state()
}

function markLocalServerStartup(error: unknown) {
  const failure = error instanceof Error ? error : new Error(String(error))
  Object.defineProperty(failure, "localServerStartup", { value: true })
  return failure
}

export function initializationReady<A>(state: (() => A | undefined) & { error: unknown; loading: boolean }) {
  if (state.loading) return false
  initializationData(state)
  return true
}
