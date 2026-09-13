export * as KnowledgeGuidance from "./guidance"

import { makeLocationNode } from "../effect/app-node"
import { Database } from "../database/database"
import { Flag } from "../flag/flag"
import { SessionHistory } from "../session/history"
import { SessionInput } from "../session/input"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { SystemContext } from "../system-context/index"
import { KnowledgeRetrieval } from "./retrieval"
import { Context, Effect, Layer, Schema } from "effect"

export const TOP_K = 3
export const MIN_QUERY_CHARS = 12
export const MAX_TOTAL_CHARS = 2500
export const MAX_PER_DOC_CHARS = 1000

const Doc = Schema.Struct({
  title: Schema.String,
  section: Schema.String,
  content: Schema.String,
})
type Doc = typeof Doc.Type

const render = (docs: ReadonlyArray<Doc>) =>
  [
    "Project knowledge retrieved for the current request. Apply the documented patterns below and do not contradict them.",
    "<retrieved_knowledge>",
    ...docs.flatMap((doc) => [
      "  <doc>",
      `    <title>${doc.title}</title>`,
      `    <section>${doc.section}</section>`,
      `    <content>${doc.content}</content>`,
      "  </doc>",
    ]),
    "</retrieved_knowledge>",
  ].join("\n")

const applyBudget = (docs: ReadonlyArray<KnowledgeRetrieval.Doc>): Doc[] => {
  const truncated = docs.map((doc) => ({ ...doc, content: doc.content.slice(0, MAX_PER_DOC_CHARS) }))
  const picked = truncated.reduce<{ docs: Doc[]; used: number }>(
    (acc, doc) =>
      acc.used >= MAX_TOTAL_CHARS
        ? acc
        : {
            docs: [...acc.docs, { title: doc.title, section: doc.section, content: doc.content }],
            used: acc.used + doc.content.length,
          },
    { docs: [], used: 0 },
  )
  return picked.docs
}

const emptyMessages: ReadonlyArray<SessionMessage.Message> = []
const emptyDocs: ReadonlyArray<KnowledgeRetrieval.Doc> = []

export interface Interface {
  readonly load: (sessionID: SessionSchema.ID) => Effect.Effect<SystemContext.SystemContext>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/KnowledgeGuidance") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const retrieval = yield* KnowledgeRetrieval.Service

    return Service.of({
      load: Effect.fn("KnowledgeGuidance.load")(function* (sessionID: SessionSchema.ID) {
        if (!Flag.OPENCODE_EXPERIMENTAL_KNOWLEDGE) return SystemContext.empty
        // First-turn source: pending input exists in the admission inbox before
        // promotion projects it into history, so read it directly when present.
        const pending = yield* SessionInput.peekPending(db, sessionID).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
          Effect.catchDefect(() => Effect.succeed(undefined)),
        )
        const pendingQuery = pending?.prompt.text.trim()
        const query =
          pendingQuery !== undefined && pendingQuery.length > 0
            ? pendingQuery
            : yield* Effect.suspend(() =>
                SessionHistory.load(db, sessionID).pipe(
                  Effect.catch(() => Effect.succeed(emptyMessages)),
                  Effect.catchDefect(() => Effect.succeed(emptyMessages)),
                  Effect.map((messages) => {
                    const last = messages.findLast((message) => message.type === "user")
                    return last && last.type === "user" ? last.text.trim() : ""
                  }),
                ),
              )
        if (query.length < MIN_QUERY_CHARS) return SystemContext.empty
        const budgeted = applyBudget(
          yield* retrieval
            .search(query, TOP_K)
            .pipe(
              Effect.catch(() => Effect.succeed(emptyDocs)),
              Effect.catchDefect(() => Effect.succeed(emptyDocs)),
            ),
        ).slice(0, TOP_K)
        if (budgeted.length === 0) return SystemContext.empty
        return SystemContext.make({
          key: SystemContext.Key.make("knowledge/retrieval"),
          codec: Schema.toCodecJson(Schema.Array(Doc)),
          load: Effect.succeed(budgeted),
          baseline: render,
          update: (_previous, current) =>
            [
              "The retrieved project knowledge has changed. This list supersedes the previous retrieved knowledge list.",
              render(current),
            ].join("\n"),
          removed: () =>
            "Retrieved project knowledge is no longer available. Do not rely on previously retrieved knowledge.",
        })
      }),
    })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node, KnowledgeRetrieval.node] })
