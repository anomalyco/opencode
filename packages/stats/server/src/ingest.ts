import { Buffer } from "node:buffer"
import { FirehoseClient, PutRecordBatchCommand } from "@aws-sdk/client-firehose"
import { Effect, Layer, Schema } from "effect"
import * as Context from "effect/Context"
import { Resource } from "sst/resource"

const MAX_FIREHOSE_BATCH_SIZE = 500
const MAX_FIREHOSE_ATTEMPTS = 3
const LAKE_TYPE = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/

type IngestEvent = Record<string, unknown>
type RoutedEvent = IngestEvent & { _lake_database: string; _lake_table: string; _lake_operation: "insert" }
type FirehoseRecord = { Data: Uint8Array }

export class IngestError extends Schema.TaggedErrorClass<IngestError>()("IngestError", {
  message: Schema.String,
  failed: Schema.Number,
  cause: Schema.optional(Schema.Defect),
}) {}

export declare namespace Ingest {
  export interface Service {
    readonly write: (events: IngestEvent[]) => Effect.Effect<{ records: number }, IngestError>
  }
}

export class Ingest extends Context.Service<Ingest, Ingest.Service>()("@opencode/stats/Ingest") {
  static readonly layer: Layer.Layer<Ingest> = Layer.effect(
    Ingest,
    Effect.sync(() => {
      const client = new FirehoseClient({})

      const write = Effect.fn("Ingest.write")(function* (events: IngestEvent[]) {
        if (events.length === 0) return { records: 0 }
        const records = events.map(routeEvent).filter((event): event is RoutedEvent => Boolean(event))
        if (records.length !== events.length) {
          return yield* new IngestError({
            message: "Unsupported lake event type",
            failed: events.length - records.length,
          })
        }

        const failed = (
          yield* Effect.all(
            chunks(
              records.map((event) => ({ Data: Buffer.from(JSON.stringify(event)) })),
              MAX_FIREHOSE_BATCH_SIZE,
            ).map((batch) => putRecords(client, Resource.LakeIngestConfig.streamName, batch)),
            { concurrency: 8 },
          )
        ).reduce((sum, item) => sum + item, 0)

        if (failed > 0) {
          return yield* new IngestError({ message: "Failed to ingest all lake records", failed })
        }

        return { records: records.length }
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
    catch: (cause) => new IngestError({ message: "Failed to write lake records to Firehose", failed: records.length, cause }),
  })
  const failed =
    result.RequestResponses?.flatMap((item, index) => {
      const record = records[index]
      if (!item.ErrorCode || !record) return []
      return [record]
    }) ?? []

  if (failed.length === 0) return 0
  if (attempt >= MAX_FIREHOSE_ATTEMPTS) return failed.length

  yield* Effect.sleep(`${250 * 2 ** (attempt - 1)} millis`)
  return yield* putRecords(client, streamName, failed, attempt + 1)
})

function routeEvent(event: IngestEvent): RoutedEvent | undefined {
  if (typeof event._datalake_key !== "string") return
  const match = event._datalake_key.match(LAKE_TYPE)
  if (!match?.[1] || !match[2]) return
  return {
    ...Object.fromEntries(Object.entries(event).filter(([key]) => key !== "_datalake_key")),
    _lake_database: match[1],
    _lake_table: match[2],
    _lake_operation: "insert" as const,
  }
}

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  )
}
