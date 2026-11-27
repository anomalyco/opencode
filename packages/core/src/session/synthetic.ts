export * as SessionSynthetic from "./synthetic.js"

import { Effect } from "effect"
import { NotFoundError, SyntheticConflictError } from "./error.js"
import { SessionInbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"
import type { SessionStore } from "./store.js"

export const make = (
  store: SessionStore.Interface,
  inbox: SessionInbox.Interface,
  wake: (id: SessionSchema.ID) => Effect.Effect<void>,
) =>
  Effect.fn("Session.synthetic")(function* (input: {
    sessionID: SessionSchema.ID
    id?: SessionMessage.ID
    text: string
    description?: string
    metadata?: Record<string, unknown>
    delivery?: SessionInbox.Delivery
    resume?: boolean
  }) {
    const sessionID = input.sessionID
    const get = store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : new NotFoundError({ sessionID }))))
    yield* get
    const id = input.id ?? SessionMessage.ID.create()
    const admitted = yield* inbox
      .admit({
        id,
        sessionID,
        item: {
          type: "synthetic",
          delivery: input.delivery ?? "steer",
          payload: SessionInbox.SyntheticPayload.make({
            text: input.text,
            description: input.description,
            metadata: input.metadata,
          }),
        },
      })
      .pipe(
        Effect.catchTag("SessionInbox.LifecycleConflict", () => new SyntheticConflictError({ sessionID, inputID: id })),
      )
    if (input.resume !== false && !(yield* get).revert) yield* wake(sessionID)
    return admitted
  }, Effect.uninterruptible)
