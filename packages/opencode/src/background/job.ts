import { BackgroundJob as CoreBackgroundJob } from "@cedric/core/background-job"
import { Database } from "@cedric/core/database/database"
import { SessionTable } from "@cedric/core/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { EventV2 } from "@cedric/core/event"
import { SessionID } from "@/session/schema"
import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Schema } from "effect"

export {
  Service,
  type ExtendInput,
  type Info,
  type Interface,
  type StartInput,
  type Status,
  type WaitInput,
  type WaitResult,
} from "@cedric/core/background-job"

export const BackgroundTaskJob = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  parentSessionID: Schema.String,
  status: Schema.Union([
    Schema.Literal("running"),
    Schema.Literal("completed"),
    Schema.Literal("error"),
    Schema.Literal("cancelled"),
  ]),
  title: Schema.optional(Schema.String),
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  progress: Schema.optional(Schema.Number),
  retryable: Schema.optional(Schema.Boolean),
  model: Schema.optional(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
  output: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "BackgroundTaskJobEvent" })
export type BackgroundTaskJob = typeof BackgroundTaskJob.Type

export const BackgroundTaskJobMetadataKey = "backgroundTaskJob"
const decodeBackgroundTaskJob = Schema.decodeUnknownOption(BackgroundTaskJob)
const decodeSessionID = Schema.decodeUnknownOption(SessionID)

export const Event = {
  Updated: EventV2.define({
    type: "background.job.updated",
    schema: {
      job: BackgroundTaskJob,
    },
  }),
}

export function taskJob(info: CoreBackgroundJob.Info): BackgroundTaskJob | undefined {
  if (info.type !== "task") return
  const sessionID = typeof info.metadata?.sessionId === "string" ? info.metadata.sessionId : undefined
  const parentSessionID = typeof info.metadata?.parentSessionId === "string" ? info.metadata.parentSessionId : undefined
  if (!sessionID || !parentSessionID) return
  const model =
    typeof info.metadata?.model === "object" &&
    info.metadata.model !== null &&
    "providerID" in info.metadata.model &&
    "modelID" in info.metadata.model &&
    typeof info.metadata.model.providerID === "string" &&
    typeof info.metadata.model.modelID === "string"
      ? { providerID: info.metadata.model.providerID, modelID: info.metadata.model.modelID }
      : undefined
  return {
    id: info.id,
    sessionID,
    parentSessionID,
    status: info.status,
    ...(info.title ? { title: info.title } : {}),
    startedAt: info.started_at,
    updatedAt: info.updated_at,
    ...(info.completed_at !== undefined ? { completedAt: info.completed_at } : {}),
    ...(info.progress !== undefined ? { progress: info.progress } : {}),
    ...(model ? { model } : {}),
    ...(info.output !== undefined ? { output: info.output } : {}),
    ...(info.error !== undefined ? { error: info.error } : {}),
  }
}

export function taskJobFromMetadata(metadata: Record<string, unknown> | undefined) {
  return Option.getOrUndefined(decodeBackgroundTaskJob(metadata?.[BackgroundTaskJobMetadataKey]))
}

/** Keeps the legacy service instance-scoped while sharing the core registry engine. */
export const layer = Layer.effect(
  CoreBackgroundJob.Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const jobs = yield* CoreBackgroundJob.make
        const unsubscribe = yield* jobs.listen((info) => {
          const job = taskJob(info)
          if (!job) return Effect.void
          return Effect.all(
            [
              events.publish(Event.Updated, { job }),
              persistTaskJob(database, job),
            ],
            { concurrency: "unbounded", discard: true },
          )
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        return jobs
      }),
    )
    return CoreBackgroundJob.Service.of({
      list: () => InstanceState.useEffect(state, (jobs) => jobs.list()),
      get: (id) => InstanceState.useEffect(state, (jobs) => jobs.get(id)),
      start: (input) => InstanceState.useEffect(state, (jobs) => jobs.start(input)),
      extend: (input) => InstanceState.useEffect(state, (jobs) => jobs.extend(input)),
      wait: (input) => InstanceState.useEffect(state, (jobs) => jobs.wait(input)),
      waitForPromotion: (id) => InstanceState.useEffect(state, (jobs) => jobs.waitForPromotion(id)),
      promote: (id) => InstanceState.useEffect(state, (jobs) => jobs.promote(id)),
      cancel: (id) => InstanceState.useEffect(state, (jobs) => jobs.cancel(id)),
      listen: (listener) => InstanceState.useEffect(state, (jobs) => jobs.listen(listener)),
    })
  }),
)

const persistTaskJob = Effect.fn("BackgroundJob.persistTaskJob")(function* (
  database: Database.Interface,
  job: BackgroundTaskJob,
) {
  const sessionID = Option.getOrUndefined(decodeSessionID(job.sessionID))
  if (!sessionID) return
  const row = yield* database.db
    .select({ metadata: SessionTable.metadata })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!row) return
  yield* database.db
    .update(SessionTable)
    .set({
      metadata: {
        ...(row.metadata ?? {}),
        [BackgroundTaskJobMetadataKey]: job,
      },
    })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer), Layer.provide(Database.defaultLayer))

export * as BackgroundJob from "./job"
