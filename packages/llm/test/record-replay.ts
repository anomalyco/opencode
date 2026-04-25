import { Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "recordings")

const RequestSnapshot = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
})

const ResponseSnapshot = Schema.Struct({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
})

const Interaction = Schema.Struct({
  request: RequestSnapshot,
  response: ResponseSnapshot,
})

const Cassette = Schema.Struct({
  version: Schema.Literal(1),
  interactions: Schema.Array(Interaction),
})

const CassetteJson = Schema.fromJsonString(Cassette)
const RequestJson = Schema.fromJsonString(RequestSnapshot)

const decodeCassette = Schema.decodeUnknownSync(Cassette)
const decodeCassetteJson = Schema.decodeUnknownSync(CassetteJson)
const encodeCassetteJson = Schema.encodeSync(CassetteJson)
const encodeRequestJson = Schema.encodeSync(RequestJson)

const isRecordMode = process.env.RECORD === "true"

const fixturePath = (name: string) => path.join(FIXTURES_DIR, `${name}.json`)

const requestHeaders = (headers: Headers) =>
  Object.fromEntries(
    [...headers.entries()].filter(([name]) => ["content-type", "accept", "openai-beta"].includes(name.toLowerCase())),
  )

const requestSnapshot = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
  const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
  return {
    method: web.method,
    url: web.url,
    headers: requestHeaders(web.headers),
    body: yield* Effect.promise(() => web.text()),
  }
})

const fixtureMissing = (request: HttpClientRequest.HttpClientRequest, name: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      description: `Fixture "${name}" not found. Run with RECORD=true to create it.`,
    }),
  })

const fixtureMismatch = (request: HttpClientRequest.HttpClientRequest, name: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      description: `Fixture "${name}" does not match the current request. Run with RECORD=true to update it.`,
    }),
  })

const responseSnapshot = (response: HttpClientResponse.HttpClientResponse, body: string) => ({
  status: response.status,
  headers: headers(response),
  body,
})

const headers = (response: HttpClientResponse.HttpClientResponse) => ({
  "content-type": response.headers["content-type"] ?? "text/event-stream",
})

export const hasFixtureSync = (name: string) => {
  try {
    decodeCassetteJson(fs.readFileSync(fixturePath(name), "utf8"))
    return true
  } catch {
    return false
  }
}

export const layer = (name: string): Layer.Layer<HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const upstream = yield* HttpClient.HttpClient
      const recorded: Array<typeof Interaction.Type> = []

      return HttpClient.make((request) => {
        if (isRecordMode) {
          return Effect.gen(function* () {
            const currentRequest = yield* requestSnapshot(request)
            const response = yield* upstream.execute(request)
            const body = yield* response.text
            const interaction = decodeCassette({
              version: 1,
              interactions: [...recorded, { request: currentRequest, response: responseSnapshot(response, body) }],
            })
            recorded.splice(0, recorded.length, ...interaction.interactions)
            fs.mkdirSync(path.dirname(fixturePath(name)), { recursive: true })
            yield* Effect.promise(() => Bun.write(fixturePath(name), encodeCassetteJson(interaction)))
            return HttpClientResponse.fromWeb(request, new Response(body, responseSnapshot(response, body)))
          })
        }

        return Effect.gen(function* () {
          const cassette = decodeCassetteJson(
            yield* Effect.tryPromise({
              try: () => Bun.file(fixturePath(name)).text(),
              catch: () => fixtureMissing(request, name),
            }),
          )
          const currentRequest = encodeRequestJson(yield* requestSnapshot(request))
          const interaction = cassette.interactions.find((interaction) => encodeRequestJson(interaction.request) === currentRequest)
          if (!interaction) {
            return yield* fixtureMismatch(request, name)
          }

          return HttpClientResponse.fromWeb(request, new Response(interaction.response.body, interaction.response))
        })
      })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))
