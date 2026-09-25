import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import type { SessionRequestKind, SessionTitle } from "@opencode/plugin/effect/session"
import { Effect, Option, Schema, Semaphore, Stream } from "effect"
import { IntegrationConnection } from "../../integration/connection.js"
import { Credential } from "../../credential.js"
import { Bus } from "../../bus.js"
import { CopilotModels } from "../../github-copilot/models.js"
import { App } from "../../app.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Agent } from "../../agent.js"
import { define } from "@opencode/plugin/effect/plugin"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

const clientID = "Ov23li8tweQw6odWQebz"
const apiVersion = "2026-08-01"
const userApiVersion = "2025-04-01"
const pollingSafetyMargin = 3000
const methodID = Integration.MethodID.make("device")

const Device = Schema.Struct({
  verification_uri: Schema.String,
  user_code: Schema.String,
  device_code: Schema.String,
  interval: Schema.Number,
})
const Token = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  interval: Schema.optional(Schema.Number),
})
const User = Schema.Struct({
  chat_enabled: Schema.optional(Schema.Boolean),
  can_signup_for_limited: Schema.optional(Schema.Boolean),
  endpoints: Schema.optional(
    Schema.Struct({
      api: Schema.optional(Schema.String),
    }),
  ),
})
const decodeUser = Schema.decodeUnknownOption(User)
const JsonBody = Schema.fromJsonString(Schema.Unknown)
const decodeBody = Schema.decodeUnknownOption(JsonBody)

const oauth = (app: App.Info) =>
  ({
    integrationID: Integration.ID.make("github-copilot"),
    method: {
      id: methodID,
      type: "oauth",
      label: "Login with GitHub Copilot",
      form: [
        {
          type: "string",
          key: "deploymentType",
          title: "Select GitHub deployment type",
          required: true,
          options: [
            { label: "GitHub.com", value: "github.com", description: "Public" },
            { label: "GitHub Enterprise", value: "enterprise", description: "Data residency or self-hosted" },
          ],
        },
        {
          type: "string",
          key: "enterpriseUrl",
          title: "Enter your GitHub Enterprise URL or domain",
          placeholder: "company.ghe.com or https://company.ghe.com",
          required: true,
          when: [{ key: "deploymentType", op: "eq", value: "enterprise" }],
        },
      ],
    },
    authorize: (answer) =>
      Effect.gen(function* () {
        const enterprise = answer.deploymentType === "enterprise"
        const enterpriseUrl = typeof answer.enterpriseUrl === "string" ? answer.enterpriseUrl : undefined
        if (enterprise && !enterpriseUrl) return yield* Effect.fail(new Error("Enterprise URL is required"))
        const domain = enterprise ? normalizeDomain(enterpriseUrl ?? "") : "github.com"
        const urls = oauthURLs(domain)
        const device = yield* request(urls.device, {
          method: "POST",
          headers: headers(app),
          body: JSON.stringify({ client_id: clientID, scope: "read:user" }),
        }).pipe(Effect.map(Schema.decodeUnknownSync(Device)))
        const interval = Math.max(device.interval, 1) * 1000

        const poll = (wait: number): Effect.Effect<Credential.OAuth, unknown> =>
          request(urls.token, {
            method: "POST",
            headers: headers(app),
            body: JSON.stringify({
              client_id: clientID,
              device_code: device.device_code,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
          }).pipe(
            Effect.map(Schema.decodeUnknownSync(Token)),
            Effect.flatMap((token) => {
              if (token.access_token) {
                const access = token.access_token
                return request(
                  `${domain === "github.com" ? "https://api.github.com" : `https://api.${domain}`}/copilot_internal/user`,
                  {
                    headers: {
                      Accept: "application/json",
                      Authorization: `Bearer ${access}`,
                      "User-Agent": App.useragent(app),
                      "X-GitHub-Api-Version": userApiVersion,
                    },
                  },
                ).pipe(
                  Effect.map((user) => Option.getOrUndefined(decodeUser(user))),
                  // Only an explicit entitlement answer blocks login; a failed
                  // or malformed lookup must not turn a GitHub hiccup into a denial.
                  Effect.orElseSucceed(() => undefined),
                  Effect.flatMap((user) => {
                    const denied = user && copilotEntitlementError(user)
                    if (denied) return Effect.fail(new Error(denied))
                    const apiEndpoint = user?.endpoints?.api?.replace(/\/+$/, "")
                    return Effect.succeed(
                      Credential.OAuth.make({
                        type: "oauth",
                        methodID,
                        refresh: access,
                        access,
                        expires: 0,
                        ...((enterprise || apiEndpoint) && {
                          metadata: {
                            ...(enterprise ? { enterpriseUrl: domain } : {}),
                            ...(apiEndpoint ? { apiEndpoint } : {}),
                          },
                        }),
                      }),
                    )
                  }),
                )
              }
              if (token.error === "authorization_pending")
                return Effect.sleep(wait + pollingSafetyMargin).pipe(Effect.andThen(poll(wait)))
              if (token.error === "slow_down") {
                const next = token.interval && token.interval > 0 ? token.interval * 1000 : wait + 5000
                return Effect.sleep(next + pollingSafetyMargin).pipe(Effect.andThen(poll(next)))
              }
              return Effect.fail(new Error(`Device authorization failed${token.error ? `: ${token.error}` : ""}`))
            }),
          )

        return {
          mode: "auto" as const,
          url: device.verification_uri,
          instructions: `Enter code: ${device.user_code}`,
          callback: poll(interval),
        }
      }),
  }) satisfies IntegrationOAuthMethodRegistration

export const GithubCopilotPlugin = define({
  id: "opencode.provider.github.copilot",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded: {
      baseURL?: string
      token?: string
      models?: CopilotModels.Snapshot
      connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    } = {}

    const load = Effect.fn("GithubCopilotPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active("github-copilot")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      if (credential?.type !== "oauth") {
        loaded.baseURL = undefined
        loaded.token = undefined
        loaded.models = undefined
        loaded.connection = undefined
        return
      }

      const url = copilotBaseURL(credential.metadata) ?? baseURL()
      const provider = yield* providers.get(Provider.ID.githubCopilot)
      const remote = yield* Effect.tryPromise({
        try: () =>
          CopilotModels.load(url, {
            ...provider?.headers,
            Authorization: `Bearer ${credential.refresh}`,
            "User-Agent": App.useragent(ctx.app),
            "X-GitHub-Api-Version": apiVersion,
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to sync GitHub Copilot models", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (
        IntegrationConnection.key(connection) !==
        IntegrationConnection.key(yield* ctx.integration.connection.active("github-copilot"))
      )
        return
      loaded.baseURL = url
      loaded.token = credential.refresh
      loaded.models = remote
      loaded.connection = connection
    })

    yield* ctx.integration.transform((editor) => {
      editor.method.remove("github-copilot", { type: "key" })
      editor.method.update(oauth(ctx.app))
    })
    yield* ctx.provider.transform((evt) => {
      const item = evt.get(Provider.ID.githubCopilot)
      if (!item) return
      if (loaded.models) {
        evt.add({
          info: item.provider,
          models: Array.from(
            CopilotModels.derive(loaded.baseURL ?? baseURL(), loaded.models, Array.from(item.models.values())).values(),
          ),
          sourceConnection: loaded.connection,
        })
        return
      }
      for (const id of item.models.keys()) {
        evt.models.update(item.provider.id, id, (model) => {
          model.package = Provider.aisdk("@ai-sdk/github-copilot")
          if (loaded.baseURL) model.settings = Provider.mergeOverlay(model.settings, { baseURL: loaded.baseURL })
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
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("github-copilot")),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.githubCopilot) return
        if (evt.package !== "@ai-sdk/github-copilot") return
        evt.options.fetch = copilotFetch(
          typeof evt.options.apiKey === "string" ? evt.options.apiKey : undefined,
          evt.options.fetch,
          ctx.app,
        )
        const mod = yield* Effect.promise(() => import("../../github-copilot/copilot-provider.js"))
        evt.sdk = mod.createOpenaiCompatible(evt.options)
      }),
    )
    yield* ctx.session.hook(
      "model.request",
      (evt) =>
        Effect.gen(function* () {
          if (evt.model.providerID !== Provider.ID.githubCopilot) return
          const session = yield* ctx.session
            .get({ sessionID: evt.sessionID })
            .pipe(Effect.orElseSucceed(() => undefined))
          const interaction = interactionType(evt.kind, session?.parentID !== undefined)
          evt.headers["X-Interaction-Type"] = interaction
          evt.headers["X-Interaction-Id"] = evt.sessionID
          if (interaction !== "conversation-agent") evt.headers["x-initiator"] = "agent"
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
          if (evt.model.providerID !== Provider.ID.githubCopilot) return
          if (!loaded.baseURL || !loaded.token || !loaded.models) return
          const agent = yield* ctx.agent.get({ agentID: Agent.ID.make("title") }).pipe(Effect.orElseSucceed(() => undefined))
          if (agent?.data.model) return
          const model = utilityTitleModels.find((id) => loaded.models?.has(id))
          if (!model) return
          evt.result = yield* utilityTitle(
            { baseURL: loaded.baseURL, token: loaded.token, model, app: ctx.app },
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
          if (evt.model.providerID !== Provider.ID.githubCopilot) return
          const token = evt.request.headers.get("x-api-key")
          if (!token) return
          const text = yield* Effect.promise(() => evt.request.clone().text())
          const body = Option.getOrUndefined(decodeBody(text))
          applyHeaders(evt.request.headers, token, ctx.app, requestMetadata(evt.request.url, body), true)
        }),
      { providerID: Provider.ID.githubCopilot },
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.githubCopilot) return
        if (evt.sdk.responses === undefined && evt.sdk.chat === undefined) {
          evt.language = evt.sdk.languageModel(evt.model.modelID ?? evt.model.id)
          return
        }
        if (evt.options.endpoint === "responses" && evt.sdk.responses) {
          evt.language = evt.sdk.responses(evt.model.modelID ?? evt.model.id)
          return
        }
        if (evt.options.endpoint === "chat" && evt.sdk.chat) {
          evt.language = evt.sdk.chat(evt.model.modelID ?? evt.model.id)
          return
        }
        const id = evt.model.modelID ?? evt.model.id
        const match = /^gpt-(\d+)/.exec(id)
        evt.language =
          match && Number(match[1]) >= 5 && !id.startsWith("gpt-5-mini") ? evt.sdk.responses(id) : evt.sdk.chat(id)
      }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)

function normalizeDomain(input: string) {
  return input.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function oauthURLs(domain: string) {
  return {
    device: `https://${domain}/login/device/code`,
    token: `https://${domain}/login/oauth/access_token`,
  }
}

function baseURL(enterprise?: string) {
  return enterprise ? `https://copilot-api.${normalizeDomain(enterprise)}` : "https://api.githubcopilot.com"
}

// GitHub reports Copilot access on /copilot_internal/user; OAuth itself succeeds
// for any GitHub account, so this is the only signal that the account can chat.
export function copilotEntitlementError(user: { chat_enabled?: boolean; can_signup_for_limited?: boolean }) {
  if (user.chat_enabled !== false) return
  if (user.can_signup_for_limited)
    return "This GitHub account is not signed up for GitHub Copilot. Sign up for Copilot Free at https://github.com/features/copilot/plans and connect again."
  return "This GitHub account does not have GitHub Copilot access. It needs an active Copilot subscription or a seat assigned by an organization."
}

export function copilotBaseURL(metadata?: Readonly<Record<string, unknown>>) {
  const endpoint = metadata?.apiEndpoint
  if (typeof endpoint === "string" && endpoint) return endpoint
  const enterprise = metadata?.enterpriseUrl
  return baseURL(typeof enterprise === "string" ? enterprise : undefined)
}

function headers(app: App.Info) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": App.useragent(app),
  }
}

function request(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { ...init, signal })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      return response.json()
    },
    catch: (cause) => cause,
  })
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

export function copilotFetch(token: string | undefined, upstream: Fetch | undefined, app: App.Info): Fetch {
  const send = upstream ?? fetch
  return async (input, init) => {
    const requestHeaders = new Headers(init?.headers)
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url
    const body = typeof init?.body === "string" ? Option.getOrUndefined(decodeBody(init.body)) : undefined
    applyHeaders(requestHeaders, token, app, requestMetadata(url, body), false)
    return send(input, { ...init, headers: requestHeaders })
  }
}

function applyHeaders(
  headers: Headers,
  token: string | undefined,
  app: App.Info,
  metadata: RequestMetadata,
  anthropic: boolean,
) {
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
  if (anthropic) headers.set("anthropic-beta", "interleaved-thinking-2025-05-14")
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
  if (!record(body)) return { agent: false, vision: false }
  if (Array.isArray(body.input)) {
    const last = body.input.at(-1)
    return {
      agent: !record(last) || last.role !== "user",
      vision: body.input.some(
        (item) =>
          record(item) &&
          Array.isArray(item.content) &&
          item.content.some((part) => record(part) && part.type === "input_image"),
      ),
    }
  }
  if (!Array.isArray(body.messages)) return { agent: false, vision: false }
  const last = body.messages.at(-1)
  if (url.includes("completions")) {
    return {
      agent: !record(last) || last.role !== "user",
      vision: body.messages.some(
        (message) =>
          record(message) &&
          Array.isArray(message.content) &&
          message.content.some((part) => record(part) && part.type === "image_url"),
      ),
    }
  }
  const content = record(last) && Array.isArray(last.content) ? last.content : []
  return {
    agent:
      !record(last) || last.role !== "user" || !content.some((part) => record(part) && part.type !== "tool_result"),
    vision: body.messages.some(
      (message) =>
        record(message) &&
        Array.isArray(message.content) &&
        message.content.some(
          (part) =>
            record(part) &&
            (part.type === "image" ||
              (part.type === "tool_result" &&
                Array.isArray(part.content) &&
                part.content.some((nested) => record(nested) && nested.type === "image"))),
        ),
    ),
  }
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
