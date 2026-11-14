import type { SessionRequestKind, SessionTitle } from "@opencode/plugin/effect/session"
import { isRecord } from "@opencode/util/record"
import { Clock, Effect, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { IntegrationConnection } from "../../integration/connection.js"
import { CopilotModels } from "../../github-copilot/models.js"
import { CopilotOAuth } from "../../github-copilot/oauth.js"
import { Flag } from "../../flag.js"
import { App } from "../../app.js"
import { Model } from "../../model.js"
import { Agent } from "../../agent.js"
import { define } from "@opencode/plugin/effect/plugin"
import { Provider } from "../../provider.js"
import { SessionAffinity } from "../../session/affinity.js"
import type { Session } from "@opencode/schema/session"
import { SharedCache } from "../../shared-cache.js"
import { activeCredential, credentialSettings } from "./credential-settings.js"
import { ProviderRefresh } from "./refresh.js"
import type { PluginInternal } from "../internal.js"

const apiVersion = "2026-08-01"
export { copilotEntitlementError } from "../../github-copilot/oauth.js"
const AutoRoute = Schema.Struct({
  session_token: Schema.String,
  expires_at: Schema.Number,
  selected_model: Schema.Struct({ id: Schema.String }),
})
const JsonBody = Schema.fromJsonString(Schema.Unknown)
const decodeBody = Schema.decodeUnknownOption(JsonBody)

export const GithubCopilotPlugin = define({
  id: "opencode.provider.github.copilot",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const cache = yield* SharedCache.Service
    const http = yield* HttpClient.HttpClient
    const flags = yield* Flag.Service
    const outbound = yield* FetchHttpClient.Fetch
    yield* ctx.integration.transform((editor) => {
      editor.method.remove("github-copilot", { type: "key" })
      editor.method.update(CopilotOAuth.method(ctx.app, http, flags.enabled("copilot_expiring_tokens")))
    })
    // Each Session keeps the model Copilot's Auto router picked until its token nears expiry, the Session is compacted,
    // or the account changes. The token unlocks the pick and its Auto discount; Copilot rejects it for any other model.
    const routes = new Map<Session.ID, { model: string; account: string; token?: string; until: number }>()
    // The endpoint saved at login serves requests until the first refresh reads the account's current one, so an
    // Enterprise login doesn't send its token to the public host while that refresh is still running.
    const login = yield* credentialSettings(ctx, "github-copilot", (value) =>
      value.type === "oauth" ? { baseURL: copilotBaseURL(value.metadata) } : {},
    )
    const discovered = yield* ProviderRefresh.start({
      integrationID: "github-copilot",
      initial: {} as {
        readonly baseURL?: string
        readonly token?: string
        readonly models?: CopilotModels.Snapshot
        readonly connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
      },
      active: ctx.integration.connection.active("github-copilot"),
      reload: ctx.provider.reload(),
      load: Effect.fn("GithubCopilotPlugin.load")(function* (_, options) {
        const { connection, credential } = yield* activeCredential(ctx, "github-copilot")
        if (!connection || credential?.type !== "oauth") return { connection, value: {} }
        // The account's API endpoint changes with its plan, so read it again on every refresh; the one stored at
        // login is the fallback.
        const endpoint = yield* cache
          .get({
            key: `github-copilot-endpoint:${IntegrationConnection.key(connection)}`,
            ...options,
            load: ctx.integration.connection.resolve(connection).pipe(
              Effect.flatMap((current) =>
                current?.type === "oauth"
                  ? HttpClient.filterStatusOk(http)
                      .execute(
                        HttpClientRequest.get(
                          CopilotOAuth.userURL(
                            typeof current.metadata?.enterpriseUrl === "string"
                              ? current.metadata.enterpriseUrl
                              : undefined,
                          ),
                        ).pipe(
                          HttpClientRequest.setHeaders({
                            Accept: "application/json",
                            Authorization: `Bearer ${CopilotOAuth.access(current)}`,
                            "User-Agent": App.useragent(ctx.app),
                            "X-GitHub-Api-Version": CopilotOAuth.userApiVersion,
                          }),
                        ),
                      )
                      .pipe(
                        Effect.flatMap(HttpClientResponse.schemaBodyJson(CopilotOAuth.User)),
                        Effect.map((user) => user.endpoints?.api?.replace(/\/+$/, "")),
                        Effect.timeout("5 seconds"),
                      )
                  : Effect.fail(new Error("GitHub Copilot connection has no OAuth credential")),
              ),
            ),
          })
          .pipe(Effect.orElseSucceed(() => undefined))
        const url = endpoint || copilotBaseURL(credential.metadata)
        const headers = (yield* providers.get(Provider.ID.githubCopilot))?.headers ?? {}
        const models = yield* cache
          .get({
            key: modelsKey(connection, url, headers),
            ...options,
            load: ctx.integration.connection.resolve(connection).pipe(
              Effect.flatMap((current) =>
                current?.type === "oauth"
                  ? CopilotModels.load(http, url, {
                      ...headers,
                      Authorization: `Bearer ${CopilotOAuth.access(current)}`,
                      "User-Agent": App.useragent(ctx.app),
                      "X-GitHub-Api-Version": apiVersion,
                    })
                  : Effect.fail(new Error("GitHub Copilot connection has no OAuth credential")),
              ),
            ),
          })
          .pipe(Effect.orElseSucceed(() => undefined))
        return { connection, value: { baseURL: url, token: CopilotOAuth.access(credential), models, connection } }
      }),
    })

    yield* ctx.provider.transform((evt) => {
      const item = evt.get(Provider.ID.githubCopilot)
      if (!item) return
      const loaded = discovered.current
      const url = loaded.baseURL ?? (typeof login.settings.baseURL === "string" ? login.settings.baseURL : baseURL())
      if (loaded.models) {
        const router = CopilotModels.autoModel(url, loaded.models)
        evt.add({
          info: item.provider,
          models: [
            ...CopilotModels.derive(url, loaded.models, Array.from(item.models.values())).values(),
            ...(router ? [router] : []),
          ],
          sourceConnection: loaded.connection,
        })
        return
      }
      // Without the live model list, the models.dev package says which Copilot API serves
      // each model: Anthropic means Messages, OpenAI means Responses, and anything else
      // falls back to the model ID.
      for (const id of item.models.keys()) {
        evt.models.update(item.provider.id, id, (model) => {
          const route = CopilotModels.routeFor(
            model.modelID ?? model.id,
            model.package === "@opencode/ai/providers/anthropic"
              ? "messages"
              : model.package === "@opencode/ai/providers/openai"
                ? "responses"
                : undefined,
            url,
          )
          model.package = route.package
          model.settings = Provider.mergeOverlay(model.settings, { baseURL: route.baseURL })
        })
      }
    })
    yield* ctx.model.transform((models) => {
      if (models.get(Provider.ID.githubCopilot, Model.ID.make("gpt-5-chat-latest"))) {
        models.update(Provider.ID.githubCopilot, Model.ID.make("gpt-5-chat-latest"), (model) => {
          // This chat-only alias conflicts with the Copilot GPT-5 Responses route,
          // so hide it only for Copilot rather than for every provider catalog.
          model.enabled = false
        })
      }
    })
    yield* ctx.session.hook(
      "model.request",
      (evt) =>
        Effect.gen(function* () {
          const session = yield* ctx.session
            .get({ sessionID: evt.sessionID })
            .pipe(Effect.orElseSucceed(() => undefined))
          const interaction = interactionType(evt.kind, session?.parentID !== undefined)
          evt.headers["X-Interaction-Type"] = interaction
          evt.headers["X-Interaction-Id"] = session ? SessionAffinity.get(session) : evt.sessionID
          if (interaction !== "conversation-agent") evt.headers["x-initiator"] = "agent"
          const route = routes.get(evt.sessionID)
          if (route?.token && route.model === evt.model.id) evt.headers["Copilot-Session-Token"] = route.token
        }),
      { providerID: Provider.ID.githubCopilot },
    )
    const requestContext = Effect.gen(function* () {
      const loaded = discovered.current
      if (!loaded.baseURL || !loaded.models || !loaded.connection) return
      const active = yield* ctx.integration.connection.active("github-copilot")
      if (IntegrationConnection.key(active) !== IntegrationConnection.key(loaded.connection)) return
      const credential = yield* ctx.integration.connection.resolve(loaded.connection)
      if (credential?.type !== "oauth") return
      return { baseURL: loaded.baseURL, models: loaded.models, token: CopilotOAuth.access(credential) }
    }).pipe(
      Effect.tapError((cause) => Effect.logWarning("GitHub Copilot credential refresh failed", { cause })),
      Effect.orElseSucceed(() => undefined),
    )
    const route = Effect.fn("GithubCopilotPlugin.route")(function* (
      sessionID: Session.ID,
      loaded: NonNullable<Effect.Success<typeof requestContext>>,
    ) {
      const user = yield* ctx.session.context({ sessionID }).pipe(
        Effect.map((messages) => messages.findLast((message) => message.type === "user")),
        Effect.orElseSucceed(() => undefined),
      )
      const headers = (yield* providers.get(Provider.ID.githubCopilot))?.headers ?? {}
      const picked = yield* HttpClient.filterStatusOk(http)
        .execute(
          HttpClientRequest.post(`${loaded.baseURL}/auto`).pipe(
            HttpClientRequest.setHeaders({
              ...headers,
              Authorization: `Bearer ${loaded.token}`,
              "User-Agent": App.useragent(ctx.app),
              "X-GitHub-Api-Version": apiVersion,
            }),
            HttpClientRequest.bodyJsonUnsafe({
              prompt: user?.text ?? "",
              ...(user?.files?.some((file) => file.mime.startsWith("image/")) ? { has_image: true } : {}),
            }),
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(AutoRoute)),
          Effect.timeout("5 seconds"),
          Effect.tapError((cause) => Effect.logWarning("Copilot Auto routing failed", { cause })),
          Effect.option,
        )
      const now = yield* Clock.currentTimeMillis
      if (Option.isSome(picked) && loaded.models.has(picked.value.selected_model.id))
        return {
          model: picked.value.selected_model.id,
          account: loaded.token,
          token: picked.value.session_token,
          // Route again before the token can expire mid-request.
          until: picked.value.expires_at * 1000 - 5 * 60_000,
        }
      const models = Array.from(loaded.models.values())
      const fallback =
        models.find((model) => model.is_chat_fallback) ?? models.find((model) => model.billing?.auto_discount)
      // Retry routing soon when the router fails or picks a model this client cannot serve.
      return fallback && { model: fallback.id, account: loaded.token, until: now + 5 * 60_000 }
    })
    yield* ctx.session.hook(
      "experimental.model.resolve",
      (evt) =>
        Effect.gen(function* () {
          // Titles use Copilot's utility model, so they never route.
          if (evt.model.id !== CopilotModels.auto || evt.kind === "title") return
          const loaded = yield* requestContext
          if (!loaded) return
          const now = yield* Clock.currentTimeMillis
          const cached = routes.get(evt.sessionID)
          const current =
            cached && cached.until > now && cached.account === loaded.token
              ? cached
              : yield* route(evt.sessionID, loaded)
          if (!current) return
          for (const [id, route] of routes) if (route.until <= now) routes.delete(id)
          routes.set(evt.sessionID, current)
          evt.model = Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: Model.ID.make(current.model) })
        }),
      { providerID: Provider.ID.githubCopilot },
    )
    // Compaction rewrites the prompt, so the request after it routes again, like Copilot's own clients. The compaction
    // request itself still carries the current pick's token.
    yield* ctx.session.hook(
      "compaction",
      (evt) =>
        Effect.sync(() => {
          const route = routes.get(evt.sessionID)
          if (route) route.until = 0
        }),
      { providerID: Provider.ID.githubCopilot },
    )
    // GitHub's integration guide designates session naming as a utility scenario served by
    // free, rate-limited utility models. Any failure leaves the result unset so the normal
    // billable title path still runs.
    yield* ctx.session.hook(
      "title",
      (evt) =>
        Effect.gen(function* () {
          const loaded = yield* requestContext
          if (!loaded) return
          const agent = yield* ctx.agent
            .get({ agentID: Agent.ID.make("title") })
            .pipe(Effect.orElseSucceed(() => undefined))
          if (agent?.data.model) return
          const model = utilityTitleModels.find((id) => loaded.models?.has(id))
          if (!model) return
          evt.result = yield* utilityTitle(
            { baseURL: loaded.baseURL, token: loaded.token, model, app: ctx.app, fetch: outbound },
            evt,
          ).pipe(
            Effect.tapError((cause) => Effect.logDebug("Copilot utility title failed", { model, cause })),
            Effect.orElseSucceed(() => undefined),
          )
        }),
      { providerID: Provider.ID.githubCopilot },
    )
    yield* ctx.session.hook(
      "http.request",
      (evt) =>
        Effect.gen(function* () {
          // The Messages route sends the token as `x-api-key`, the OpenAI routes as a bearer token.
          const token =
            evt.request.headers.get("x-api-key") ?? evt.request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
          if (!token) return
          const text = yield* Effect.promise(() => evt.request.clone().text())
          const body = Option.getOrUndefined(decodeBody(text))
          applyHeaders(evt.request.headers, token, ctx.app, requestMetadata(evt.request.url, body))
        }),
      { providerID: Provider.ID.githubCopilot },
    )
  }),
} satisfies PluginInternal.InternalPlugin)

function modelsKey(
  connection: Parameters<typeof IntegrationConnection.key>[0],
  url: string,
  headers: Record<string, string>,
) {
  const fingerprint = SharedCache.fingerprint(JSON.stringify(Object.entries(headers).toSorted()))
  return `github-copilot:${IntegrationConnection.key(connection)}:${url}:${fingerprint}`
}

function normalizeDomain(input: string) {
  return input.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function baseURL(enterprise?: string) {
  return enterprise ? `https://copilot-api.${normalizeDomain(enterprise)}` : "https://api.githubcopilot.com"
}

export function copilotBaseURL(metadata?: Readonly<Record<string, unknown>>) {
  const endpoint = metadata?.apiEndpoint
  if (typeof endpoint === "string" && endpoint) return endpoint
  const enterprise = metadata?.enterpriseUrl
  return baseURL(typeof enterprise === "string" ? enterprise : undefined)
}

type Fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>

// Matches the Copilot client: gpt-4o-mini is the "small utility" model; when an account
// lacks it the request falls through to the regular title path instead of another guess.
export const utilityTitleModels = ["gpt-4o-mini"]

const UtilityCompletion = Schema.Struct({
  choices: Schema.Array(Schema.Struct({ message: Schema.Struct({ content: Schema.NullOr(Schema.String) }) })),
})
const decodeUtilityCompletion = Schema.decodeUnknownEffect(Schema.fromJsonString(UtilityCompletion))

// This issues its own /chat/completions call instead of steering core's title request.
// The `session.title` hook exposes `model` read-only, so pointing core at another model
// would mean widening that contract and re-resolving inside SessionModelRequest; rewriting
// the body in `http.request` is worse still, since the endpoint (/responses for GPT-5,
// /v1/messages for Claude) is fixed before that hook runs and gpt-4o-mini only serves
// /chat/completions. Utility titles are Copilot-specific, stateless, non-streaming, and
// free, so a small request here costs less than a core seam. Trade-offs: no session
// usage record for the title step (the call bills nothing) and no `http.*` hook visibility.
export function utilityTitle(
  input: { baseURL: string; token: string; model: string; app: App.Info; fetch?: Fetch },
  request: Pick<SessionTitle, "sessionID" | "system" | "messages" | "options">,
) {
  const send = input.fetch ?? fetch
  const text = (parts: ReadonlyArray<{ type: string; text?: string | null }>) =>
    parts.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
  const messages = [
    ...(request.system.length ? [{ role: "system", content: text(request.system) }] : []),
    ...request.messages.map((message) => ({ role: message.role, content: text(message.content) })),
  ]
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await send(`${input.baseURL}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
          "User-Agent": App.useragent(input.app),
          "X-GitHub-Api-Version": apiVersion,
          "Openai-Intent": "conversation-edits",
          "X-Interaction-Type": "agent-session-name-generation",
          "X-Interaction-Id": request.sessionID,
          "x-initiator": "agent",
        },
        body: JSON.stringify({
          model: input.model,
          messages,
          stream: false,
          ...(typeof request.options.maxTokens === "number" ? { max_tokens: request.options.maxTokens } : {}),
        }),
      })
      if (!response.ok) throw new Error(`Utility title request failed: ${response.status}`)
      return response.text()
    },
    catch: (cause) => cause,
  }).pipe(
    Effect.timeout("20 seconds"),
    Effect.flatMap(decodeUtilityCompletion),
    Effect.flatMap((completion) => {
      const title = completion.choices[0]?.message.content?.trim()
      return title ? Effect.succeed(title) : Effect.fail(new Error("Utility title response was empty"))
    }),
  )
}

function applyHeaders(headers: Headers, token: string | undefined, app: App.Info, metadata: RequestMetadata) {
  if (token) {
    headers.delete("authorization")
    headers.delete("x-api-key")
    headers.set("Authorization", `Bearer ${token}`)
  }
  headers.set("User-Agent", App.useragent(app))
  headers.set("Openai-Intent", "conversation-edits")
  headers.set("X-GitHub-Api-Version", apiVersion)
  // The step may already have declared itself agent-initiated (subagent, title, compaction);
  // the body can only ever escalate to "agent", never back to "user".
  if (metadata.agent) headers.set("x-initiator", "agent")
  else if (!headers.has("x-initiator")) headers.set("x-initiator", "user")
  if (metadata.vision) headers.set("Copilot-Vision-Request", "true")
}

// Mirrors the Copilot client's X-Interaction-Type vocabulary: the agent loop is the default,
// nested sessions are subagents, and title/compaction are the two utility overrides.
export function interactionType(kind: SessionRequestKind, child: boolean) {
  if (kind === "title") return "conversation-background"
  if (kind === "compaction") return "conversation-compaction"
  if (child) return "conversation-subagent"
  return "conversation-agent"
}

type RequestMetadata = ReturnType<typeof requestMetadata>

function requestMetadata(url: string, body: unknown) {
  if (!isRecord(body)) return { agent: false, vision: false }
  if (Array.isArray(body.input)) {
    const last = body.input.at(-1)
    return {
      agent: !isRecord(last) || last.role !== "user",
      // Tool results carry their images in `output`, user messages in `content`.
      vision: body.input.some(
        (item) =>
          isRecord(item) &&
          [item.content, item.output].some(
            (parts) => Array.isArray(parts) && parts.some((part) => isRecord(part) && part.type === "input_image"),
          ),
      ),
    }
  }
  if (!Array.isArray(body.messages)) return { agent: false, vision: false }
  const last = body.messages.at(-1)
  if (url.includes("completions")) {
    const previous = body.messages.at(-2)
    return {
      // Chat Completions moves tool-result images into a user message after the tool messages.
      agent: !isRecord(last) || last.role !== "user" || (isRecord(previous) && previous.role === "tool"),
      vision: body.messages.some(
        (message) =>
          isRecord(message) &&
          Array.isArray(message.content) &&
          message.content.some((part) => isRecord(part) && part.type === "image_url"),
      ),
    }
  }
  const content = isRecord(last) && Array.isArray(last.content) ? last.content : []
  return {
    agent:
      !isRecord(last) || last.role !== "user" || !content.some((part) => isRecord(part) && part.type !== "tool_result"),
    vision: body.messages.some(
      (message) =>
        isRecord(message) &&
        Array.isArray(message.content) &&
        message.content.some(
          (part) =>
            isRecord(part) &&
            (part.type === "image" ||
              (part.type === "tool_result" &&
                Array.isArray(part.content) &&
                part.content.some((nested) => isRecord(nested) && nested.type === "image"))),
        ),
    ),
  }
}
