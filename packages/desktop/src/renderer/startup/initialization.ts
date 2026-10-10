import type { ElectronAPI } from "../api-types"
import { Predicate } from "effect"

type SidecarData = Awaited<ReturnType<ElectronAPI["awaitInitialization"]>>

export function initializationData<A>(state: (() => A | undefined) & { error: unknown }) {
  if (state.error !== undefined) throw initializationError(state.error)

  return state()
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
    const next = await input.api.reconnectService()

    if (signal.aborted) throw signal.reason

    if (!sameSidecar(input.current(), next)) input.update(next)

    return sidecarHttp(next)
  }
}

function sameSidecar(current: SidecarData | undefined, next: SidecarData) {
  return current?.url === next.url
}

export function initializationError(error: unknown) {
  const failure =
    error instanceof Error
      ? error
      : new Error(
          Predicate.hasProperty(error, "message") && Predicate.isString(error.message) ? error.message : String(error),
          { cause: error },
        )
  Object.defineProperty(failure, "localServerStartup", { value: true })

  return failure
}
