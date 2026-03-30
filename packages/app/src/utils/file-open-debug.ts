const key = "opencode:debug:file-open"
const starts = new Map<string, number>()
let ready = false

function enabled() {
  if (typeof window === "undefined") return false
  return localStorage.getItem(key) === "1" || document.documentElement.dataset.debugFileOpen === "1"
}

function now() {
  if (typeof performance === "undefined") return 0
  return performance.now()
}

export function fileOpenStart(path: string, event: string, data?: Record<string, unknown>) {
  if (!enabled()) return
  const at = now()
  starts.set(path, at)
  console.warn(`[file-open] ${event}`, {
    path,
    at: Math.round(at),
    ...data,
  })
}

export function fileOpenTrace(path: string, event: string, data?: Record<string, unknown>) {
  if (!enabled()) return
  const at = now()
  const start = starts.get(path)
  console.warn(`[file-open] ${event}`, {
    path,
    at: Math.round(at),
    since: start === undefined ? undefined : Math.round(at - start),
    ...data,
  })
}

export function fileOpenEnd(path: string, event: string, data?: Record<string, unknown>) {
  if (!enabled()) return
  const at = now()
  const start = starts.get(path)
  console.warn(`[file-open] ${event}`, {
    path,
    at: Math.round(at),
    total: start === undefined ? undefined : Math.round(at - start),
    ...data,
  })
  starts.delete(path)
}

export function fileOpenReady(scope: string) {
  if (ready) return
  ready = true
  if (typeof window === "undefined") return
  console.info("[file-open] instrumentation ready", {
    scope,
    origin: window.location.origin,
    enabled: enabled(),
  })
}
