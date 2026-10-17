/** A cap keeps a runaway session from filling storage; the oldest pins fall off first. */
export const MAX_PINS_PER_SESSION = 100

/** Adds an ID to the front of a pin list, newest first, without duplicates. */
export function addPin(pins: readonly string[], messageID: string): string[] {
  if (pins[0] === messageID) return [...pins]

  return [messageID, ...pins.filter((id) => id !== messageID)].slice(0, MAX_PINS_PER_SESSION)
}

/** Removes an ID from a pin list. */
export function removePin(pins: readonly string[], messageID: string): string[] {
  return pins.filter((id) => id !== messageID)
}
