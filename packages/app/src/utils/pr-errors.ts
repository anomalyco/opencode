interface ApiError {
  code?: string
  message?: string
}

export function parseApiError(e: unknown): ApiError {
  if (e && typeof e === "object") {
    if ("error" in e) {
      const inner = (e as { error?: unknown }).error
      if (inner && typeof inner === "object") {
        return inner as ApiError
      }
    }
    if ("code" in e || "message" in e) {
      return e as ApiError
    }
  }
  if (e instanceof Error) return { message: e.message }
  if (typeof e === "string") return { message: e }
  return {}
}

export function resolveApiErrorMessage(
  e: unknown,
  fallback: string,
  translate?: (key: string) => string,
): string {
  const err = parseApiError(e)
  if (err.code && translate) {
    const key = `pr.error.${err.code.toLowerCase()}`
    const translated = translate(key)
    if (translated !== key) return translated
  }
  return err.message ?? fallback
}
