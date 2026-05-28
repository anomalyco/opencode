import { Buffer } from "node:buffer"
import { timingSafeEqual } from "node:crypto"
import { Effect, Schema } from "effect"
import * as Semaphore from "effect/Semaphore"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Resource } from "sst/resource"
import { Ingest } from "./ingest"
import { isShuttingDown } from "./shutdown"

const MAX_CONCURRENT_INGEST_REQUESTS = 8

const IngestPayload = Schema.Struct({
  events: Schema.optional(Schema.Unknown),
})

export const Routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const ingestService = yield* Ingest
    const ingestRequests = yield* Semaphore.make(MAX_CONCURRENT_INGEST_REQUESTS)

    yield* Effect.all(
      [
        router.add("GET", "/health", () => json(200, { ok: true })),
        router.add("GET", "/ready", () => json(isShuttingDown() ? 503 : 200, { ok: !isShuttingDown() })),
        router.add("POST", "/", ingestRequests.withPermit(ingest(ingestService))),
      ],
      { discard: true },
    )
  }),
)

const ingest = (ingestService: Ingest.Service) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!isAuthorized(request.headers)) return yield* json(401, { ok: false, error: "Unauthorized" })

    const payload = yield* HttpServerRequest.schemaBodyJson(IngestPayload).pipe(
      Effect.match({
        onFailure: () => undefined,
        onSuccess: (value) => value,
      }),
    )
    if (!payload) return yield* json(400, { ok: false, error: "Invalid JSON body" })

    const events = Array.isArray(payload.events) ? payload.events : []
    if (events.length === 0) return yield* json(202, { ok: true, records: 0 })

    return yield* ingestService.write(events).pipe(
      Effect.flatMap((result) => json(202, { ok: true, records: result.records })),
      Effect.catchTag("IngestError", (error) =>
        json(502, { ok: false, records: countRecords(events), failed: error.failed }),
      ),
    )
  })

function isAuthorized(headers: Record<string, string | undefined>) {
  const actual = Buffer.from(headers.authorization ?? headers.Authorization ?? "")
  const expected = Buffer.from(`Bearer ${Resource.LakeIngestConfig.secret}`)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function countRecords(items: unknown[]) {
  let records = 0
  for (const item of items) {
    if (Boolean(item) && typeof item === "object" && !Array.isArray(item)) records++
  }
  return records
}

function json(status: number, body: Record<string, unknown>) {
  return HttpServerResponse.json(body, { status }).pipe(Effect.orDie)
}
