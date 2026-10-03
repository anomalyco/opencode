export type SidecarSupervisor = {
  /** Whether an exit should trigger a respawn. Increments the attempt counter when true. */
  shouldRespawn: (code: number) => boolean
  /** Reset the attempt counter after a successful respawn. */
  succeeded: () => void
  readonly attempts: number
}

// Deliberate stops report code 0; crashes report non-zero fast-fail codes
// (e.g. 0xC0000409). Both can be transient under memory pressure, so any
// exit while the app is running is eligible for a bounded number of
// consecutive respawn attempts. The counter resets after a respawn becomes
// healthy, so sporadic crashes hours apart never exhaust the limit.
export function createSidecarSupervisor(input: { respawnLimit: number }): SidecarSupervisor {
  let attempts = 0
  return {
    get attempts() {
      return attempts
    },
    shouldRespawn() {
      if (attempts >= input.respawnLimit) return false
      attempts++
      return true
    },
    succeeded() {
      attempts = 0
    },
  }
}
