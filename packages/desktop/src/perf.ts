import { invoke } from "@tauri-apps/api/core"

type Api = {
  enabled: boolean
  mark: (name: string, data?: unknown) => void
  span: <T>(name: string, fn: () => Promise<T>, data?: unknown) => Promise<T>
}

const enabled = !!window.__OPENCODE__?.perfEnabled

const mark = (name: string, data?: unknown) => {
  if (!enabled) return
  const at = performance.now()
  void invoke("perf_event", {
    name,
    // Some versions of the Tauri JS bridge expect camelCase.
    // Send both to keep the Rust command signature stable.
    atMs: at,
    at_ms: at,
    data: data === undefined ? null : JSON.stringify(data),
  }).catch(() => undefined)
}

const span = async <T,>(name: string, fn: () => Promise<T>, data?: unknown) => {
  if (!enabled) return fn()

  mark(`${name}:start`, data)
  const start = performance.now()
  const res = await fn()
  mark(`${name}:end`, { elapsed_ms: performance.now() - start, data: data ?? null })
  return res
}

export const perf: Api = {
  enabled,
  mark,
  span,
}

if (enabled) {
  window.__OPENCODE__ ??= {}
  window.__OPENCODE__.perf = perf
}
