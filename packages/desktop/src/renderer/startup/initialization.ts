import type { ElectronAPI } from "../api-types"

type SidecarData = Awaited<ReturnType<ElectronAPI["awaitInitialization"]>>

export function initializationData<A>(state: (() => A | undefined) & { error: unknown }) {
  if (state.error === undefined) return state()
  const failure = state.error instanceof Error ? state.error : new Error(String(state.error))
  Object.defineProperty(failure, "localServerStartup", { value: true })

  throw failure
}

// The main process adds Authorization to sidecar requests (`wireRendererHeaders`); the renderer never
// holds the password, and its GETs carry only CORS-safelisted headers so they skip the preflight.
export function sidecarHttp(data: SidecarData) {
  return { url: data.url }
}

export function createSidecarResolver(input: {
  api: Pick<ElectronAPI, "reconnectService">
  current: () => SidecarData | undefined
  update: (data: SidecarData) => void
}) {
  return async (signal: AbortSignal) => {
    if (signal.aborted) throw signal.reason
    // Aborting interrupts this window's wait in main; the reconnect keeps running for other windows.
    const next = await input.api.reconnectService(signal)

    if (signal.aborted) throw signal.reason

    if (!sameSidecar(input.current(), next)) input.update(next)

    return sidecarHttp(next)
  }
}

function sameSidecar(current: SidecarData | undefined, next: SidecarData) {
  return current?.url === next.url
}
