export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: NodeJS.Timeout
  return Promise.race([
    promise.then((result) => {
      clearTimeout(timeout)
      return result
    }),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Operation timed out after ${ms}ms`))
      }, ms)
    }),
  ])
}

export function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+(?:\.\d+)?)\s*(h|m|s|ms)?$/)
  if (!match) {
    throw new Error(
      `Invalid timeout format (${timeout}). Expected format: "60s", "2m", "1h", "500ms".`,
    )
  }

  const value = parseFloat(match[1])
  const unit = match[2] || "ms"

  switch (unit) {
    case "h":
      return value * 60 * 60 * 1000
    case "m":
      return value * 60 * 1000
    case "s":
      return value * 1000
    case "ms":
      return value
    default:
      throw new Error(`Invalid timeout unit (${unit}). Expected h, m, s, or ms.`)
  }
}
