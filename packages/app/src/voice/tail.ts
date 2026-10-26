type Utterance = { id: number; role: "user" | "assistant"; text: string; at: number; version: number; sent: number }

// Live sends transcript deltas, not finalized messages. Keep one utterance
// across adjacent deltas, and reserve its version while a delegation runs.
export class TranscriptTail {
  private entries: Utterance[] = []
  private next = 0
  private reservations = new Map<string, Map<number, number>>()

  append(role: Utterance["role"], delta: string) {
    const previous = this.entries.at(-1)

    if (previous?.role === role && Date.now() - previous.at < 1500) {
      previous.text += delta
      previous.at = Date.now()
      previous.version++

      return previous.text
    }

    this.entries.push({ id: this.next++, role, text: delta, at: Date.now(), version: 1, sent: 0 })
    this.entries = this.entries.slice(-60)

    return delta
  }

  /** Both sides' lines since the previous delegation, as the iOS app's `transcript_delta`. */
  capture(id: string) {
    const pending = this.entries.filter(
      (entry) =>
        entry.version >
        Math.max(entry.sent, ...[...this.reservations.values()].map((versions) => versions.get(entry.id) ?? 0)),
    )

    const versions = new Map(pending.map((entry) => [entry.id, entry.version]))
    this.reservations.set(id, versions)

    return pending.map((entry) => `${entry.role}${entry.sent ? " (updated utterance)" : ""}: ${entry.text.trim()}`)
  }

  accept(id: string) {
    const versions = this.reservations.get(id)
    this.entries.forEach((entry) => {
      entry.sent = Math.max(entry.sent, versions?.get(entry.id) ?? 0)
    })
    this.reservations.delete(id)
  }

  release(id: string) {
    this.reservations.delete(id)
  }

  get lines() {
    return this.entries
      .slice(-12)
      .map((entry) => `${entry.role}: ${entry.text}`)
      .join("\n")
      .slice(-2000)
  }

  /** The newest utterance; it changes only when `append` starts a new one. */
  get latest() {
    return this.entries.at(-1)?.id
  }
}
