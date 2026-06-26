export function initializationData<A>(state: (() => A | undefined) & { error: unknown }) {
  if (state.error !== undefined) throw markLocalServerStartup(state.error)
  return state()
}

function markLocalServerStartup(error: unknown) {
  const failure = error instanceof Error ? error : new Error(String(error))
  const prefix = "Error invoking remote method 'await-initialization': Error: "
  if (failure.message.startsWith(prefix)) {
    const previous = failure.message
    failure.message = failure.message.slice(prefix.length)
    if (failure.stack) failure.stack = failure.stack.replace(`Error: ${previous}`, `Error: ${failure.message}`)
  }
  Object.defineProperty(failure, "localServerStartup", { value: true })
  return failure
}

export function initializationReady<A>(state: (() => A | undefined) & { error: unknown; loading: boolean }) {
  if (state.loading) return false
  initializationData(state)
  return true
}
