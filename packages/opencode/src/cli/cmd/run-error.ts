export function createRunErrorDeduper() {
  let sessionErrorEmitted = false
  const requestErrors = new Set<string>()
  return (error: unknown, source: "session" | "request") => {
    const key = errorKey(error)
    if (source === "session") {
      if (key && requestErrors.has(key)) return true
      sessionErrorEmitted = true
      return false
    }
    if (key) requestErrors.add(key)
    return sessionErrorEmitted
  }
}

function errorKey(error: unknown) {
  if (!error || typeof error !== "object" || !("name" in error) || !("data" in error)) return
  const data = error.data
  if (!data || typeof data !== "object" || !("message" in data)) return
  return JSON.stringify([String(error.name), String(data.message)])
}
