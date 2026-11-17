import {
  capturedLines,
  createTranscriptTailState,
  transcriptLines,
  transitionTranscriptTail,
  type TranscriptRole,
  type TranscriptTailEvent,
} from "./tail-machine"

/** Drives the transcript machine in `tail-machine.ts` for one call. */
export class TranscriptTail {
  private state = createTranscriptTailState()

  /** The utterance's text so far, or "" when the delta added nothing to show. */
  append(role: TranscriptRole, delta: string) {
    const previous = this.state
    this.dispatch({ type: "utterance.appended", role, delta, at: Date.now() })

    if (this.state === previous) return ""

    return this.state.entries.at(-1)?.text ?? ""
  }

  /** Both sides' lines since the previous delegation, as the iOS app's `transcript_delta`. */
  capture(id: string) {
    this.dispatch({ type: "delegation.captured", id })

    return [...capturedLines(this.state, id)]
  }

  accept(id: string) {
    this.dispatch({ type: "delegation.accepted", id })
  }

  release(id: string) {
    this.dispatch({ type: "delegation.released", id })
  }

  clearReservations() {
    this.dispatch({ type: "reservations.cleared" })
  }

  get lines() {
    return transcriptLines(this.state)
  }

  /** The newest utterance; it changes only when `append` starts a new one. */
  get latest() {
    return this.state.entries.at(-1)?.id
  }

  private dispatch(event: TranscriptTailEvent) {
    this.state = transitionTranscriptTail(this.state, event)
  }
}
