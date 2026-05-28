import { Buffer } from "node:buffer"
import { FirehoseClient, PutRecordBatchCommand } from "@aws-sdk/client-firehose"
import { Effect, Layer, Schema } from "effect"
import * as Context from "effect/Context"
import { Resource } from "sst/resource"

const MAX_FIREHOSE_BATCH_SIZE = 500
const MAX_FIREHOSE_ATTEMPTS = 3
const LAKE_TYPE = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/

type IngestEvent = Record<string, unknown>
type LakeRoute = { database: string; table: string }
type FirehoseRecord = { Data: Uint8Array }

export class IngestError extends Schema.TaggedErrorClass<IngestError>()("IngestError", {
  message: Schema.String,
  failed: Schema.Number,
  cause: Schema.optional(Schema.Defect),
}) {}

export declare namespace Ingest {
  export interface Service {
    readonly write: (events: unknown[]) => Effect.Effect<{ records: number }, IngestError>
  }
}

export class Ingest extends Context.Service<Ingest, Ingest.Service>()("@opencode/stats/Ingest") {
  static readonly layer: Layer.Layer<Ingest> = Layer.effect(
    Ingest,
    Effect.sync(() => {
      const client = new FirehoseClient({})

      const write = Effect.fn("Ingest.write")(function* (events: unknown[]) {
        if (events.length === 0) return { records: 0 }
        const counts = countRoutedEvents(events)
        if (counts.unsupported > 0) {
          yield* Effect.logWarning(
            `lake ingest rejected ${JSON.stringify({ records: counts.records, unsupported: counts.unsupported })}`,
          )
          return yield* new IngestError({
            message: "Unsupported lake event type",
            failed: counts.unsupported,
          })
        }
        if (counts.records === 0) return { records: 0 }

        let batch: FirehoseRecord[] = []
        let batches = 0
        let failed = 0

        for (const event of events) {
          if (!isRecord(event)) continue
          const route = routeEvent(event)
          if (!route) continue
          batch.push(toFirehoseRecord(event, route))
          if (batch.length < MAX_FIREHOSE_BATCH_SIZE) continue
          failed += yield* putRecords(client, Resource.LakeIngestConfig.streamName, batch)
          batches++
          batch = []
        }

        if (batch.length > 0) {
          failed += yield* putRecords(client, Resource.LakeIngestConfig.streamName, batch)
          batches++
        }

        if (failed > 0) {
          yield* Effect.logWarning(`lake ingest incomplete ${JSON.stringify({ records: counts.records, failed })}`)
          return yield* new IngestError({ message: "Failed to ingest all lake records", failed })
        }

        yield* Effect.logInfo(`lake ingest complete ${JSON.stringify({ records: counts.records, batches })}`)
        return { records: counts.records }
      })

      return Ingest.of({ write })
    }),
  )
}

const putRecords: (
  client: FirehoseClient,
  streamName: string,
  records: FirehoseRecord[],
  attempt?: number,
) => Effect.Effect<number, IngestError> = Effect.fn("Ingest.putRecords")(function* (
  client,
  streamName,
  records,
  attempt = 1,
) {
  const result = yield* Effect.tryPromise({
    try: () => client.send(new PutRecordBatchCommand({ DeliveryStreamName: streamName, Records: records })),
    catch: (cause) =>
      new IngestError({ message: "Failed to write lake records to Firehose", failed: records.length, cause }),
  }).pipe(
    Effect.tapError(() =>
      Effect.logWarning(`firehose batch write failed ${JSON.stringify({ records: records.length, attempt })}`),
    ),
  )
  const failed =
    result.RequestResponses?.flatMap((item, index) => {
      const record = records[index]
      if (!item.ErrorCode || !record) return []
      return [record]
    }) ?? []

  if (failed.length === 0) return 0
  if (attempt >= MAX_FIREHOSE_ATTEMPTS) {
    yield* Effect.logWarning(
      `firehose batch failed ${JSON.stringify({ records: failed.length, attempts: MAX_FIREHOSE_ATTEMPTS })}`,
    )
    return failed.length
  }

  yield* Effect.logWarning(
    `firehose batch retrying ${JSON.stringify({ records: failed.length, attempt: attempt + 1 })}`,
  )
  yield* Effect.sleep(`${250 * 2 ** (attempt - 1)} millis`)
  return yield* putRecords(client, streamName, failed, attempt + 1)
})

function countRoutedEvents(events: unknown[]) {
  let records = 0
  let unsupported = 0
  for (const event of events) {
    if (!isRecord(event)) continue
    if (routeEvent(event)) records++
    else unsupported++
  }
  return { records, unsupported }
}

function isRecord(item: unknown): item is IngestEvent {
  return Boolean(item) && typeof item === "object" && !Array.isArray(item)
}

function routeEvent(event: IngestEvent): LakeRoute | undefined {
  if (typeof event._datalake_key !== "string") return
  const match = event._datalake_key.match(LAKE_TYPE)
  if (!match?.[1] || !match[2]) return
  return {
    database: match[1],
    table: match[2],
  }
}

function toFirehoseRecord(event: IngestEvent, route: LakeRoute): FirehoseRecord {
  return {
    Data: Buffer.from(
      JSON.stringify({
        ...Object.fromEntries(Object.entries(event).filter(([key]) => key !== "_datalake_key")),
        _lake_database: route.database,
        _lake_table: route.table,
        _lake_operation: "insert" as const,
      }),
    ),
  }
}
