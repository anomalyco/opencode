import { Buffer } from "node:buffer"
import { timingSafeEqual } from "node:crypto"
import { Effect, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Resource } from "sst/resource"
import { Ingest } from "./ingest"
import { isShuttingDown } from "./shutdown"

const IngestPayload = Schema.Struct({
  events: Schema.optional(Schema.Unknown),
})

export const Routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const ingestService = yield* Ingest

    yield* Effect.all(
      [
        router.add("GET", "/health", () => json(200, { ok: true })),
        router.add("GET", "/ready", () => json(isShuttingDown() ? 503 : 200, { ok: !isShuttingDown() })),
        router.add("POST", "/", ingest(ingestService)),
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

    const events = Array.isArray(payload.events) ? payload.events.filter(isRecord) : []
    if (events.length === 0) return yield* json(202, { ok: true, records: 0 })

    return yield* ingestService.write(events).pipe(
      Effect.flatMap((result) => json(202, { ok: true, records: result.records })),
      Effect.catchTag("IngestError", (error) => json(502, { ok: false, records: events.length, failed: error.failed })),
    )
  })

function isAuthorized(headers: Record<string, string | undefined>) {
  const actual = Buffer.from(headers.authorization ?? headers.Authorization ?? "")
  const expected = Buffer.from(`Bearer ${Resource.LakeIngestConfig.secret}`)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function isRecord(item: unknown): item is Record<string, unknown> {
  return Boolean(item) && typeof item === "object" && !Array.isArray(item)
}

function json(status: number, body: Record<string, unknown>) {
  return HttpServerResponse.json(body, { status }).pipe(Effect.orDie)
}
