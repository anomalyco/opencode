export function formatRepoError(err: unknown, fallback = "Request failed") {
  const detail = extractErrorDetail(err)
  if (detail) return detail
  const data = extractErrorData(err)
  if (data !== undefined) {
    const serialized = safeStringify(data)
    if (serialized) return `Request failed: ${serialized}`
  }
  const serializedErr = safeStringify(err)
  if (serializedErr) return `Request failed: ${serializedErr}`
  return fallback
}

export function formatRepoErrorWithContext(err: unknown, context: string, fallback = "Request failed") {
  const detail = extractErrorDetail(err)
  if (detail && detail !== context) return `${context}\n${detail}`
  const data = extractErrorData(err)
  if (data !== undefined) {
    const serialized = safeStringify(data)
    if (serialized && serialized !== context) return `${context}\n${serialized}`
  }
  const serializedErr = safeStringify(err)
  if (serializedErr && serializedErr !== context) return `${context}\n${serializedErr}`
  return context || fallback
}

function extractErrorDetail(err: unknown) {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { error?: { message?: string }; message?: string } }).data
    if (data?.error?.message) return data.error.message
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return ""
}

function extractErrorData(err: unknown) {
  if (err && typeof err === "object" && "data" in err) {
    return (err as { data?: unknown }).data
  }
  return undefined
}

function safeStringify(data: unknown) {
  try {
    return JSON.stringify(data, getCircularReplacer())
  } catch {
    return ""
  }
}

function getCircularReplacer() {
  const seen = new WeakSet<object>()
  return (_key: string, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`
    return value
  }
}
