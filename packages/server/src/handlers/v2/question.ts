import { Database } from "@opencode-ai/core/database/database"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { V2Api } from "../../api"
import { QuestionNotFoundError, SessionNotFoundError } from "../../errors"
import { response } from "../../groups/v2/location"

function missingRequest(id: QuestionV2.ID) {
  return new QuestionNotFoundError({ requestID: id, message: `Question request not found: ${id}` })
}

export const questionHandlers = HttpApiBuilder.group(V2Api, "v2.question", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "questionRequests",
      Effect.fn(function* () {
        return yield* response((yield* QuestionV2.Service).list())
      }),
    )
  }),
)

export const sessionQuestionHandlers = HttpApiBuilder.group(V2Api, "v2.session.question", (handlers) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const locations = yield* LocationServiceMap

    const withSessionQuestion = Effect.fnUntraced(function* <A, E>(
      sessionID: QuestionV2.Request["sessionID"],
      use: (question: QuestionV2.Interface) => Effect.Effect<A, E>,
    ) {
      const row = yield* db
        .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row)
        return yield* new SessionNotFoundError({
          sessionID,
          message: `Session not found: ${sessionID}`,
        })

      return yield* Effect.gen(function* () {
        return yield* use(yield* QuestionV2.Service)
      }).pipe(
        Effect.scoped,
        Effect.provide(
          locations.get({ directory: AbsolutePath.make(row.directory), workspaceID: row.workspaceID ?? undefined }),
        ),
      )
    })

    const withOwnedQuestion = Effect.fnUntraced(function* <A, E>(
      sessionID: QuestionV2.Request["sessionID"],
      requestID: QuestionV2.ID,
      use: (question: QuestionV2.Interface) => Effect.Effect<A, E>,
    ) {
      return yield* withSessionQuestion(sessionID, (question) =>
        Effect.gen(function* () {
          const request = (yield* question.list()).find((request) => request.id === requestID)
          if (!request || request.sessionID !== sessionID) return yield* missingRequest(requestID)
          return yield* use(question)
        }),
      )
    })

    return handlers
      .handle(
        "questionRequestReply",
        Effect.fn(function* (ctx) {
          yield* withOwnedQuestion(ctx.params.sessionID, ctx.params.requestID, (question) =>
            question
              .reply({ requestID: ctx.params.requestID, answers: ctx.payload.answers })
              .pipe(Effect.catchTag("QuestionV2.NotFoundError", () => missingRequest(ctx.params.requestID))),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "questionRequestReject",
        Effect.fn(function* (ctx) {
          yield* withOwnedQuestion(ctx.params.sessionID, ctx.params.requestID, (question) =>
            question
              .reject(ctx.params.requestID)
              .pipe(Effect.catchTag("QuestionV2.NotFoundError", () => missingRequest(ctx.params.requestID))),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
