export function destinationOrigin(input: string) {
  if (input === "about:blank") return input
  if (!URL.canParse(input)) return undefined
  const url = new URL(input)
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined
  return url.origin
}

export function allowedDestination(input: string, approvedOrigin: string) {
  return input === "about:blank" || destinationOrigin(input) === approvedOrigin
}

export function normalizeBounds(input: { x: number; y: number; width: number; height: number }, parent: Electron.Rectangle) {
  if (![input.x, input.y, input.width, input.height].every(Number.isFinite)) return undefined
  const x = Math.max(0, Math.min(Math.round(input.x), parent.width))
  const y = Math.max(0, Math.min(Math.round(input.y), parent.height))
  const right = Math.max(x, Math.min(Math.round(input.x + input.width), parent.width))
  const bottom = Math.max(y, Math.min(Math.round(input.y + input.height), parent.height))
  if (right === x || bottom === y) return undefined
  return { x, y, width: right - x, height: bottom - y }
}
