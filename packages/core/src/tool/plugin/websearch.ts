export * as WebSearchTool from "./websearch.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { ToolFailure } from "@opencode/ai/effect"
import { isRecord } from "@opencode/util/record"
import { Effect, Option, Schema, Semaphore, type JsonSchema } from "effect"
import { HttpClientError } from "effect/http"
import { Flag } from "../../flag.js"
import { Form } from "../../form.js"
import { Permission } from "../../permission.js"
import { WebSearch } from "../../websearch.js"
import { WebSearchMcp } from "../../plugin/websearch/mcp.js"

export const name = "websearch"
export const NO_RESULTS = "No search results found. Please try a different query."
const providerSelectionLock = Semaphore.makeUnsafe(1)
const httpErrors = new Map([
  [429, "Web search rate limited (HTTP 429)"],
  [401, "Web search authentication failed (HTTP 401)"],
])

export const description = `Search the web using the user's selected search integration. Use this for current information beyond knowledge cutoff.

Pass \`providerID\` to pick the search provider for this call; the accepted values are listed in that parameter. Omit it to use the user's saved or random provider, and put the provider there rather than in the query text.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  providerID: Schema.optionalKey(WebSearch.ID).annotate({
    description: "Search provider for this call. Omit to use the user's saved or random provider.",
  }),
})

const Output = Schema.Array(
  Schema.Struct({
    url: WebSearch.Result.fields.url,
    title: WebSearch.Result.fields.title,
    published: WebSearch.Result.fields.time.fields.published,
    content: WebSearch.Result.fields.content,
  }),
)
export const Plugin = {
  id: "opencode.tool.websearch",
  effect: Effect.fn("WebSearchTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const forms = yield* Form.Service
    const websearch = yield* WebSearch.Service
    const flags = yield* Flag.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          // Pinned so quick questions call it without searching the catalog first.
          options: flags.current().full_codemode.enabled ? { codemode: { pinned: true } } : { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const requested = input.providerID
              const approval = {
                action: name,
                resources: [input.query],
                save: ["*"],
                metadata: input,
                ...Permission.invocation(context),
              }
              let needsConsent = false
              if (requested !== undefined) {
                const providers = (yield* ctx.websearch.providers()).data
                // A bad ID fails before the approval prompt so it cannot record a saved permission, but a policy
                // deny still outranks it: `assertNotDenied` evaluates the rules without asking the user.
                if (!providers.some((provider) => provider.id === requested)) {
                  yield* permission.assertNotDenied(approval)
                  return yield* new ToolFailure({
                    message: `Unknown web search provider "${requested}". Available: ${providers.map((provider) => provider.id).join(", ") || "none"}.`,
                  })
                }
                // A saved "disabled" choice outranks a per-call provider; no saved choice still needs consent.
                const saved = yield* websearch.default().pipe(Effect.option)
                if (Option.isNone(saved)) {
                  yield* permission.assertNotDenied(approval)
                  return yield* new WebSearch.DisabledError()
                }
                needsConsent = saved.value === undefined
                // A provider the user saved outranks a per-call request: only `random` (or no choice yet) leaves the
                // routing to the model. Otherwise the request has to agree with the user's choice.
                const pinned = yield* websearch.selection()
                if (pinned !== undefined && pinned !== false && pinned !== "random" && pinned !== requested) {
                  yield* permission.assertNotDenied(approval)
                  return yield* new ToolFailure({
                    message: `Web search is pinned to "${pinned}" by the user. Omit providerID or pass "${pinned}".`,
                  })
                }
              }
              yield* permission.assert(approval)
              const search = (providerID?: WebSearch.ID) =>
                websearch.query(
                  { ...input, providerID },
                  {
                    sessionID: context.sessionID,
                    onProvider: (provider) => context.progress({ provider: provider.id }),
                  },
                )
              // A pinned provider is used as-is: no failover, and consent never overrides it.
              const attempt: Effect.Effect<WebSearch.Response, WebSearch.Error> = needsConsent
                ? Effect.fail(new WebSearch.ProviderRequiredError())
                : search(requested)
              const result = yield* attempt.pipe(
                Effect.catchTag("WebSearch.ProviderRequired", () => {
                  return providerSelectionLock
                    .withPermit(
                      Effect.gen(function* () {
                        if (yield* websearch.default()) return
                        const providers = (yield* ctx.websearch.providers()).data
                        const defaultProvider = providers[0]
                        if (!defaultProvider) return yield* new WebSearch.ProviderRequiredError()
                        const response = yield* forms.ask({
                          sessionID: context.sessionID,
                          title: "Web Search",
                          metadata: { kind: "websearch.provider" },
                          fields: [
                            {
                              key: "choice",
                              description: "Allow OpenCode to search the web for up-to-date information?",
                              type: "string",
                              required: true,
                              custom: false,
                              options: [
                                {
                                  value: "allow",
                                  label: `Allow search via ${providers.map((provider) => provider.name).join(", ")}`,
                                },
                                {
                                  value: "choose",
                                  label: "Choose another provider",
                                },
                                { value: "disable", label: "Disable web search" },
                              ],
                            },
                          ],
                        })
                        if (response.status === "cancelled")
                          return yield* Effect.fail(new Error("Web search cancelled"))
                        if (response.answer.choice === "disable") {
                          yield* websearch.select(false)
                          return yield* new WebSearch.DisabledError()
                        }
                        const selection =
                          response.answer.choice === "choose"
                            ? yield* forms.ask({
                                sessionID: context.sessionID,
                                title: "Choose a web search provider",
                                metadata: { kind: "websearch.provider" },
                                fields: [
                                  {
                                    key: "provider",
                                    description: "Choose a provider for web search.",
                                    type: "string",
                                    required: true,
                                    custom: false,
                                    options: providers.map((provider) => ({
                                      value: provider.id,
                                      label: provider.name,
                                    })),
                                  },
                                ],
                              })
                            : undefined
                        if (selection?.status === "cancelled")
                          return yield* Effect.fail(new Error("Web search cancelled"))
                        const providerID = selection?.answer.provider ?? "random"
                        if (providerID === "random") {
                          yield* websearch.select("random")
                          return
                        }
                        const provider = providers.find((provider) => provider.id === providerID)
                        if (!provider) return yield* new WebSearch.ProviderRequiredError()
                        yield* websearch.select(provider.id)
                        return provider.id
                      }),
                    )
                    .pipe(
                      Effect.timeoutOrElse({
                        duration: "1 minute",
                        orElse: () => Effect.fail(new Error("Web search cancelled")),
                      }),
                      // Consent never overrides the provider the model pinned for this call.
                      Effect.flatMap((providerID) => search(requested ?? providerID)),
                    )
                }),
              )
              const output = result.results.map((hit) => ({
                url: hit.url,
                ...(hit.title === undefined ? {} : { title: hit.title }),
                ...(hit.content === undefined ? {} : { content: hit.content }),
                ...(hit.time.published === undefined ? {} : { published: hit.time.published }),
              }))
              const content = result.results.length
                ? result.results
                    .map((result) => {
                      const title = result.title ?? result.url
                      const published = result.time.published
                        ? `\nPublished: ${new Date(result.time.published).toISOString()}`
                        : ""
                      return `## [${title}](${result.url})${published}${result.content ? `\n\n${result.content}` : ""}`
                    })
                    .join("\n\n")
                : NO_RESULTS
              return { output, content, metadata: { provider: result.providerID } }
            }).pipe(
              Effect.mapError((error) => {
                // The tool already produced a precise, model-facing message.
                if (error instanceof ToolFailure) return error
                const fallback = `Unable to search the web for ${input.query}`
                if (!Schema.is(WebSearch.RequestError)(error)) return new ToolFailure({ message: fallback, error })
                const status = HttpClientError.isHttpClientError(error.cause) ? error.cause.response?.status : undefined
                return new ToolFailure({
                  message: Schema.is(WebSearchMcp.ToolError)(error.cause)
                    ? `Web search failed: ${error.cause.message}`
                    : status === undefined
                      ? fallback
                      : (httpErrors.get(status) ?? `Web search request failed (HTTP ${status})`),
                  error,
                  metadata: { provider: error.providerID },
                })
              }),
            ),
        }),
      )
      .pipe(Effect.orDie)

    // Whether the tool is offered at all (disabled, or policy removed every provider) is decided by the model tool
    // policy, so this hook only publishes the accepted ids. A tool definition converts its schema once at
    // registration, which is why the enum is written per request instead. With `full_codemode` enabled the tool can
    // move to the Code Mode catalog, whose schema is rendered and cached from the registry, so the enum reaches the
    // model only while the tool is direct; an unknown id still fails with the list of available ones in `execute`.
    const hook = (event: SessionContext) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        const properties = tool?.input.properties
        if (!tool || !isRecord(properties)) return
        const providers = yield* websearch.providers()
        if (providers.length === 0) return
        // A provider the user saved is the only one a call can use, so don't advertise the others.
        const pinned = yield* websearch.selection()
        const accepted =
          typeof pinned === "string" && pinned !== "random" ? [pinned] : providers.map((provider) => provider.id)
        tool.input = {
          ...tool.input,
          properties: {
            ...properties,
            providerID: {
              type: "string",
              enum: Array.from(new Set(accepted)).toSorted(),
            },
          } satisfies JsonSchema.JsonSchema,
        }
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
