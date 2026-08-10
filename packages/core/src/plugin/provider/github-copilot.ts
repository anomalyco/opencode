import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import { Effect, Option, Schema, Semaphore, Stream } from "effect"
import { Catalog } from "../../catalog"
import { Credential } from "../../credential"
import { Bus } from "../../bus"
import { CopilotModels } from "../../github-copilot/models"
import { App } from "../../app"
import { Integration } from "../../integration"
import { Model } from "../../model"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Provider } from "../../provider"
import type { PluginInternal } from "../internal"

const clientID = "Ov23li8tweQw6odWQebz"
const apiVersion = "2026-06-01"
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
  endpoints: Schema.optional(
    Schema.Struct({
      api: Schema.optional(Schema.String),
    }),
  ),
})
const decodeUser = Schema.decodeUnknownOption(User)
const JsonBody = Schema.UnknownFromJsonString
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
                  Effect.map((user) => Option.getOrUndefined(decodeUser(user))?.endpoints?.api?.replace(/\/+$/, "")),
                  Effect.catch(() => Effect.succeed(undefined)),
                  Effect.map((apiEndpoint) =>
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
                  ),
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
  id: "opencode.provider.github-copilot",
  effect: Effect.fn(function* (ctx) {
    const catalog = yield* Catalog.Service
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded: {
      baseURL?: string
      models?: Map<Model.ID, Model.Info>
    } = {}

    const load = Effect.fn("GithubCopilotPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active("github-copilot")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      if (credential?.type !== "oauth") {
        loaded.baseURL = undefined
        loaded.models = undefined
        return
      }

      loaded.baseURL = copilotBaseURL(credential.metadata)
      const provider = yield* catalog.provider.get(Provider.ID.githubCopilot)
      const existing = (yield* catalog.model.all()).filter((model) => model.providerID === Provider.ID.githubCopilot)
      loaded.models = yield* Effect.tryPromise({
        try: () =>
          CopilotModels.get(
            loaded.baseURL ?? baseURL(),
            {
              ...provider?.headers,
              Authorization: `Bearer ${credential.refresh}`,
              "User-Agent": App.useragent(ctx.app),
              "X-GitHub-Api-Version": apiVersion,
            },
            existing,
          ),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to sync GitHub Copilot models", { cause }).pipe(Effect.as(undefined)),
        ),
      )
    })

    yield* ctx.integration.transform((draft) => {
      draft.method.remove("github-copilot", { type: "key" })
      draft.method.update(oauth(ctx.app))
    })
    yield* ctx.catalog.transform((evt) => {
      const item = evt.provider.get(Provider.ID.githubCopilot)
      if (!item) return
      if (loaded.models) {
        for (const id of item.models.keys()) {
          if (!loaded.models.has(Model.ID.make(id))) evt.model.remove(item.provider.id, id)
        }
        for (const [id, model] of loaded.models) {
          evt.model.update(item.provider.id, id, (draft) => Object.assign(draft, structuredClone(model)))
        }
      } else if (loaded.baseURL) {
        for (const id of item.models.keys()) {
          evt.model.update(item.provider.id, id, (model) => {
            model.settings = Provider.mergeOverlay(model.settings, { baseURL: loaded.baseURL })
          })
        }
      }
      if (item.models.has(Model.ID.make("gpt-5-chat-latest"))) {
        evt.model.update(item.provider.id, Model.ID.make("gpt-5-chat-latest"), (model) => {
          // This chat-only alias conflicts with the Copilot GPT-5 Responses route,
          // so hide it only for Copilot rather than for every provider catalog.
          model.enabled = false
        })
      }
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* bus.subscribe(Integration.Event.ConnectionUpdated).pipe(
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
        const mod = yield* Effect.promise(() => import("../../github-copilot/copilot-provider"))
        evt.sdk = mod.createOpenaiCompatible(evt.options)
      }),
    )
    yield* ctx.session.hook("http.request", (evt) =>
      Effect.gen(function* () {
        if (evt.model.providerID !== Provider.ID.githubCopilot) return
        const token = evt.request.headers.get("x-api-key")
        if (!token) return
        const text = yield* Effect.promise(() => evt.request.clone().text())
        const body = Option.getOrUndefined(decodeBody(text))
        applyHeaders(evt.request.headers, token, ctx.app, requestMetadata(evt.request.url, body), true)
      }),
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
  headers.set("x-initiator", metadata.agent ? "agent" : "user")
  if (metadata.vision) headers.set("Copilot-Vision-Request", "true")
  if (anthropic) headers.set("anthropic-beta", "interleaved-thinking-2025-05-14")
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
