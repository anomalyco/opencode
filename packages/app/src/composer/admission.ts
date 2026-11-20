import type { ComposerSession } from "./adapter"
import {
  SERVER_PROMPT_STATUS,
  transitionPromptStatus,
  type PromptStatusEvent,
  type PromptStatusState,
} from "./prompt-status-machine"

/** The parts of a Session an admission drives: its prompt API, its optimistic busy status and its send recency. */
export type PromptSession = Pick<ComposerSession, "id" | "admitted"> & {
  data: Pick<ComposerSession["data"], "session">
}

/** A prompt with the admission ID its caller minted, so a retry can reuse it. */
export type PromptAdmission = Omit<Parameters<PromptSession["data"]["session"]["prompt"]>[0], "id"> & {
  id: string
}

// The optimistic busy status of each session, by session ID. Module-wide, because a new session's first prompt and
// the follow-ups sent from its own composer go through different submit machines. A session left out is `server`.
const statuses = new Map<string, PromptStatusState>()

function updateStatus(session: PromptSession, event: PromptStatusEvent) {
  const result = transitionPromptStatus(statuses.get(session.id) ?? SERVER_PROMPT_STATUS, event)

  if (result.state.type === "server") statuses.delete(session.id)

  if (result.state.type === "optimistic") statuses.set(session.id, result.state)
  result.effects.forEach((effect) => session.data.session.setStatus(session.id, effect.status))
}

/**
 * Admits one prompt for both composers: the busy state flips before the payload is ready, and a rejected send is
 * retried once under the same ID. Server admission is idempotent per ID, so a lost response cannot deliver the
 * message twice. The session's recency floors only once the prompt is admitted.
 */
export async function admitPrompt(input: {
  session: PromptSession
  /** Matches the admission's own ID; the busy state needs it before a prepared payload resolves. */
  id: string
  working: boolean
  admission: PromptAdmission | Promise<PromptAdmission>
}) {
  const session = input.session

  updateStatus(session, { type: "dispatched", id: input.id, working: input.working })

  // Preparing the payload can reject too (a staged revert's commit, an attachment read); the busy state it just
  // applied must return to idle, since no admission follows to settle it.
  const result = await Promise.resolve(input.admission)
    .then((admission) => session.data.session.prompt(admission).catch(() => session.data.session.prompt(admission)))
    .then(
      () => ({ ok: true as const }),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected send is opaque; the caller formats it
      (error: unknown) => ({ ok: false as const, error }),
    )

  // A failure whose row is already admitted only lost the response.
  const admitted = result.ok || session.admitted(input.id)

  updateStatus(session, admitted ? { type: "admitted" } : { type: "failed", id: input.id })

  if (!admitted) throw result.error
  session.data.session.acceptSend(session.id)
}
