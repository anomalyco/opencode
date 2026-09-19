export type LoadModelsError = "invalidUrl" | "unauthorized" | "invalidFormat" | "timeout" | "failed"

export type LoadModelsResult = { ok: true; models: string[] } | { ok: false; error: LoadModelsError }

export function parseDiscoveryResult(data: unknown): LoadModelsResult {
  if (data !== null && typeof data === "object" && "ok" in data) {
    if (data.ok === true) {
      const ids = (data as { ids?: unknown }).ids
      if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) {
        return { ok: true, models: [...new Set(ids.map((id) => id.trim()).filter(Boolean))] }
      }
      return { ok: false, error: "invalidFormat" }
    }
    if (data.ok === false) {
      const kind = (data as { kind?: unknown }).kind
      if (typeof kind === "string" && isLoadModelError(kind)) return { ok: false, error: kind }
    }
  }
  return { ok: false, error: "failed" }
}

function isLoadModelError(value: string): value is LoadModelsError {
  return (
    value === "invalidUrl" ||
    value === "unauthorized" ||
    value === "invalidFormat" ||
    value === "timeout" ||
    value === "failed"
  )
}
