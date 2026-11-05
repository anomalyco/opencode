export const UTTERANCE_MERGE_WINDOW = 1_500
export const MAX_UTTERANCES = 60

export type TranscriptRole = "user" | "assistant"

/** How much of an utterance the delegator has heard; `sent` is the revision it last heard. */
export type UtteranceDelivery =
  | { readonly status: "unsent"; readonly revision: number }
  | { readonly status: "sent"; readonly revision: number }
  | { readonly status: "revised"; readonly revision: number; readonly sent: number }

export type TranscriptUtterance = {
  readonly id: number
  readonly role: TranscriptRole
  readonly text: string
  readonly at: number
  readonly delivery: UtteranceDelivery
}

/** The utterance revisions an open delegation captured, and the lines it was given. */
export type TranscriptReservation = {
  readonly revisions: ReadonlyMap<number, number>
  readonly lines: readonly string[]
}

export type TranscriptTailState = {
  readonly nextID: number
  readonly entries: readonly TranscriptUtterance[]
  readonly reservations: ReadonlyMap<string, TranscriptReservation>
}

export type TranscriptTailEvent =
  | { readonly type: "utterance.appended"; readonly role: TranscriptRole; readonly delta: string; readonly at: number }
  | { readonly type: "delegation.captured"; readonly id: string }
  | { readonly type: "delegation.accepted"; readonly id: string }
  | { readonly type: "delegation.released"; readonly id: string }
  | { readonly type: "reservations.cleared" }

export function createTranscriptTailState(): TranscriptTailState {
  return { nextID: 0, entries: [], reservations: new Map() }
}

// Live sends transcript deltas, not finalized messages. Keep one utterance across adjacent deltas,
// and reserve its revision while a delegation runs.
export function transitionTranscriptTail(state: TranscriptTailState, event: TranscriptTailEvent): TranscriptTailState {
  if (event.type === "utterance.appended") return appended(state, event)

  if (event.type === "delegation.captured") {
    // A repeated capture keeps the reservation it already holds.
    if (state.reservations.has(event.id)) return state
    const pending = state.entries.filter((entry) => entry.delivery.revision > covered(state, entry))

    return {
      ...state,
      reservations: new Map(state.reservations).set(event.id, {
        revisions: new Map(pending.map((entry) => [entry.id, entry.delivery.revision])),
        lines: pending.map(
          (entry) =>
            `${entry.role}${entry.delivery.status === "revised" ? " (updated utterance)" : ""}: ${entry.text.trim()}`,
        ),
      }),
    }
  }

  if (event.type === "reservations.cleared") return state.reservations.size ? { ...state, reservations: new Map() } : state
  const reservation = state.reservations.get(event.id)

  if (!reservation) return state
  const reservations = new Map(state.reservations)
  reservations.delete(event.id)

  if (event.type === "delegation.released") return { ...state, reservations }

  return {
    ...state,
    reservations,
    entries: state.entries.map((entry) => {
      const reserved = reservation.revisions.get(entry.id)

      if (reserved === undefined || reserved <= heard(entry.delivery)) return entry

      if (reserved >= entry.delivery.revision)
        return { ...entry, delivery: { status: "sent", revision: entry.delivery.revision } }

      return { ...entry, delivery: { status: "revised", revision: entry.delivery.revision, sent: reserved } }
    }),
  }
}

/** The recent transcript both sides spoke, for Live's instructions. */
export function transcriptLines(state: TranscriptTailState) {
  return state.entries
    .slice(-12)
    .map((entry) => `${entry.role}: ${entry.text}`)
    .join("\n")
    .slice(-2000)
}

export function capturedLines(state: TranscriptTailState, id: string) {
  return state.reservations.get(id)?.lines ?? []
}

function appended(state: TranscriptTailState, event: Extract<TranscriptTailEvent, { type: "utterance.appended" }>) {
  if (!event.delta) return state
  const previous = state.entries.at(-1)

  if (previous?.role === event.role && event.at - previous.at < UTTERANCE_MERGE_WINDOW) {
    const text = previous.text + event.delta
    // Spacing is kept for the caption, but only new words make the utterance worth sending again.
    const delivery = text.trim() === previous.text.trim() ? previous.delivery : revise(previous.delivery)

    return { ...state, entries: [...state.entries.slice(0, -1), { ...previous, text, at: event.at, delivery }] }
  }

  if (!event.delta.trim()) return state

  return {
    ...state,
    nextID: state.nextID + 1,
    entries: [
      ...state.entries,
      {
        id: state.nextID,
        role: event.role,
        text: event.delta,
        at: event.at,
        delivery: { status: "unsent", revision: 1 } as const,
      },
    ].slice(-MAX_UTTERANCES),
  }
}

function revise(delivery: UtteranceDelivery): UtteranceDelivery {
  if (delivery.status === "unsent") return { status: "unsent", revision: delivery.revision + 1 }

  return { status: "revised", revision: delivery.revision + 1, sent: heard(delivery) }
}

function heard(delivery: UtteranceDelivery) {
  if (delivery.status === "unsent") return 0

  if (delivery.status === "sent") return delivery.revision

  return delivery.sent
}

/** The newest revision of an utterance that the delegator has heard or an open delegation holds. */
function covered(state: TranscriptTailState, entry: TranscriptUtterance) {
  return Math.max(
    heard(entry.delivery),
    ...[...state.reservations.values()].map((reservation) => reservation.revisions.get(entry.id) ?? 0),
  )
}
