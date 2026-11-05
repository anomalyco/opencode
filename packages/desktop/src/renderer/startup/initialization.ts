import type { ElectronAPI } from "../api-types"

type SidecarData = Awaited<ReturnType<ElectronAPI["awaitInitialization"]>>

/** Marks a startup failure so the error page describes it as the local server failing to start. */
export function localServerStartupError(cause: unknown) {
  const failure = cause instanceof Error ? cause : new Error(String(cause))
  Object.defineProperty(failure, "localServerStartup", { value: true })

  return failure
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
