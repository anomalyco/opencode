export * as SessionRuntime from "./runtime"

import { and, eq } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionProjector } from "./projector"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionPromptAdmissionTable } from "./sql"

export class PromptConflictError extends Schema.TaggedErrorClass<PromptConflictError>()("Session.PromptConflictError", {
  sessionID: SessionSchema.ID,
  idempotencyKey: Prompt.IdempotencyKey,
}) {}

export type PromptInput = {
  id?: EventV2.ID
  sessionID: SessionSchema.ID
  idempotencyKey?: Prompt.IdempotencyKey
  prompt: Prompt
  delivery?: SessionSchema.Delivery
  resume?: boolean
}

export interface Interface {
  /** Durably admit input at the runtime that owns the Session's Location. */
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionMessage.User, PromptConflictError>
}

/**
 * Routes runtime-bound Session operations to the implementation for the Session's Location.
 *
 * This stays in core. Callers use `sessions.prompt(...)`; they do not inspect Location,
 * provision remote compute, or connect resident runtimes themselves. The initial layer is
 * local-only. A later core-owned routed layer will select the current process for an
 * implicit-local Location and proxy an explicit `workspaceID` Location to its resident
 * runtime. As those paths are connected, add resume, interrupt, shell, and skill here too.
 * Workspace/Host provider naming and replacement orchestration remain open design work.
 */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRuntime") {}

/** Current-process implementation for implicit-local Locations. */
export const localLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)
    const decodeUserMessage = Schema.decodeUnknownEffect(SessionMessage.User)

    const getUserMessage = Effect.fnUntraced(function* (messageID: SessionMessage.ID) {
      const row = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, messageID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* Effect.die("Prompt projection was not stored")
      const message = yield* decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie)
      if (message.type !== "user") return yield* Effect.die("Prompt projection did not produce a user message")
      return message
    })

    const findAdmission = Effect.fnUntraced(function* (input: {
      sessionID: SessionSchema.ID
      idempotencyKey: Prompt.IdempotencyKey
      prompt: Prompt
    }) {
      const admitted = yield* db
        .select()
        .from(SessionPromptAdmissionTable)
        .where(
          and(
            eq(SessionPromptAdmissionTable.session_id, input.sessionID),
            eq(SessionPromptAdmissionTable.idempotency_key, input.idempotencyKey),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (!admitted) return undefined
      const prompt = yield* Prompt.decodeUnknown(admitted.prompt).pipe(Effect.orDie)
      if (!Prompt.equivalence(prompt, input.prompt)) {
        return yield* new PromptConflictError({
          sessionID: input.sessionID,
          idempotencyKey: input.idempotencyKey,
        })
      }
      return yield* decodeUserMessage(admitted.message).pipe(Effect.orDie)
    })

    return Service.of({
      prompt: Effect.fn("SessionRuntime.prompt")(function* (input) {
        const admission = input.idempotencyKey === undefined
          ? undefined
          : { sessionID: input.sessionID, idempotencyKey: input.idempotencyKey, prompt: input.prompt }
        if (admission !== undefined) {
          const admitted = yield* findAdmission(admission)
          if (admitted) return admitted
        }
        const messageID = input.id ?? EventV2.ID.create()
        const raced = yield* events
          .publish(
            SessionEvent.Prompted,
            {
              sessionID: input.sessionID,
              timestamp: yield* DateTime.now,
              idempotencyKey: input.idempotencyKey,
              prompt: input.prompt,
            },
            { id: messageID },
          )
          .pipe(
            Effect.as<SessionMessage.User | undefined>(undefined),
            Effect.catchDefect((defect) => {
              if (!(defect instanceof SessionProjector.PromptAdmissionRace) || admission === undefined) {
                return Effect.die(defect)
              }
              return findAdmission(admission).pipe(
                Effect.flatMap((admitted) => (admitted ? Effect.succeed(admitted) : Effect.die(defect))),
              )
            }),
          )
        if (raced) return raced
        // TODO: Enqueue Session execution after admission without making prompt wait for the model loop.
        return yield* getUserMessage(messageID)
      }),
    })
  }),
)
