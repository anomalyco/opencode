import type { ElectronAPI } from "../api-types"

type SidecarData = Awaited<ReturnType<ElectronAPI["awaitInitialization"]>>

export function initializationData<A>(state: (() => A | undefined) & { error: unknown }) {
  if (state.error !== undefined) throw markLocalServerStartup(state.error)
  return state()
}

// No password: the main process adds Authorization to sidecar requests (`wireRendererHeaders`), so
// the renderer's GETs carry only CORS-safelisted headers and skip the preflight round trip.
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
    const next = await input.api.reconnectService()
    if (signal.aborted) throw signal.reason
    if (!sameSidecar(input.current(), next)) input.update(next)
    return sidecarHttp(next)
  }
}

function sameSidecar(current: SidecarData | undefined, next: SidecarData) {
  return current?.url === next.url && current.password === next.password
}

function markLocalServerStartup(error: unknown) {
  const failure = error instanceof Error ? error : new Error(String(error))
  Object.defineProperty(failure, "localServerStartup", { value: true })
  return failure
}
