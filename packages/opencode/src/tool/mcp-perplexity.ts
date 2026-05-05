import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

const PERPLEXITY_URL = "https://api.perplexity.ai/search"

export const SearchArgs = Schema.Struct({
  query: Schema.String,
  numResults: Schema.optional(Schema.Number),
  contextMaxCharacters: Schema.optional(Schema.Number),
})

const PerplexityResultItem = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  snippet: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
})

const PerplexityResult = Schema.Struct({
  results: Schema.Array(PerplexityResultItem),
})

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(PerplexityResult))

const PerplexityRequest = Schema.Struct({
  query: Schema.String,
  max_results: Schema.optional(Schema.Number),
})

export const call = (
  http: HttpClient.HttpClient,
  args: typeof SearchArgs.Type,
  timeout: Duration.Input,
) =>
  Effect.gen(function* () {
    const apiKey = process.env.PERPLEXITY_API_KEY ?? process.env.PPLX_API_KEY
    if (!apiKey) return yield* Effect.die(new Error("PERPLEXITY_API_KEY is not set"))

    const request = yield* HttpClientRequest.post(PERPLEXITY_URL).pipe(
      HttpClientRequest.bearerToken(apiKey),
      HttpClientRequest.setHeader("X-Pplx-Integration", `opencode/${InstallationVersion}`),
      HttpClientRequest.acceptJson,
      HttpClientRequest.schemaBodyJson(PerplexityRequest)({
        query: args.query,
        max_results: args.numResults ?? 8,
      }),
    )

    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.die(new Error("perplexity websearch request timed out")),
        }),
      )

    const body = yield* response.text
    const parsed = yield* decode(body)

    let output = parsed.results
      .map((r, i) => {
        const parts = [`${i + 1}. ${r.title}`, `   ${r.url}`]
        if (r.snippet) parts.push(`   ${r.snippet}`)
        if (r.date) parts.push(`   (${r.date})`)
        return parts.join("\n")
      })
      .join("\n\n")

    if (args.contextMaxCharacters && output.length > args.contextMaxCharacters) {
      output = output.slice(0, args.contextMaxCharacters)
    }

    return output || undefined
  })
