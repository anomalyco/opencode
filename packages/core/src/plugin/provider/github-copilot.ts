import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { Effect, Option, Schema, Semaphore, Stream } from "effect"
import { Catalog } from "../../catalog"
import { Credential } from "../../credential"
import { EventV2 } from "../../event"
import { CopilotModels } from "../../github-copilot/models"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { ProviderV2 } from "../../provider"
import type { PluginInternal } from "../internal"

const clientID = "Ov23li8tweQw6odWQebz"
const apiVersion = "2026-06-01"
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
const JsonBody = Schema.UnknownFromJsonString
const decodeBody = Schema.decodeUnknownOption(JsonBody)

const oauth = {
  integrationID: Integration.ID.make("github-copilot"),
  method: {
    id: methodID,
    type: "oauth",
    label: "Login with GitHub Copilot",
    prompts: [
      {
        type: "select",
        key: "deploymentType",
        message: "Select GitHub deployment type",
        options: [
          { label: "GitHub.com", value: "github.com", hint: "Public" },
          { label: "GitHub Enterprise", value: "enterprise", hint: "Data residency or self-hosted" },
        ],
      },
      {
        type: "text",
        key: "enterpriseUrl",
        message: "Enter your GitHub Enterprise URL or domain",
        placeholder: "company.ghe.com or https://company.ghe.com",
        when: { key: "deploymentType", op: "eq", value: "enterprise" },
      },
    ],
  },
  authorize: (inputs) =>
    Effect.gen(function* () {
      const enterprise = inputs.deploymentType === "enterprise"
      if (enterprise && !inputs.enterpriseUrl) return yield* Effect.fail(new Error("Enterprise URL is required"))
      const domain = enterprise ? normalizeDomain(inputs.enterpriseUrl ?? "") : "github.com"
      const urls = oauthURLs(domain)
      const device = yield* request(urls.device, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ client_id: clientID, scope: "read:user" }),
      }).pipe(Effect.map(Schema.decodeUnknownSync(Device)))
      const interval = Math.max(device.interval, 1) * 1000

      const poll = (wait: number): Effect.Effect<Credential.OAuth, unknown> =>
        request(urls.token, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            client_id: clientID,
            device_code: device.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        }).pipe(
          Effect.map(Schema.decodeUnknownSync(Token)),
          Effect.flatMap((token) => {
            if (token.access_token) {
              return Effect.succeed(
                Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  refresh: token.access_token,
                  access: token.access_token,
                  expires: 0,
                  ...(enterprise ? { metadata: { enterpriseUrl: domain } } : {}),
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
} satisfies IntegrationOAuthMethodRegistration

function shouldUseResponses(modelID: string) {
  // Copilot supports Responses for GPT-5 class models, except mini variants
  // which still need the chat-completions endpoint.
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

export const GithubCopilotPlugin = define({
  id: "opencode.provider.github-copilot",
  effect: Effect.fn(function* (ctx) {
    const catalog = yield* Catalog.Service
    const events = yield* EventV2.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded: {
      baseURL?: string
      models?: Map<ModelV2.ID, ModelV2.Info>
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

      const enterprise = credential.metadata?.enterpriseUrl
      loaded.baseURL = baseURL(typeof enterprise === "string" ? enterprise : undefined)
      const provider = yield* catalog.provider.get(ProviderV2.ID.githubCopilot)
      const existing = (yield* catalog.model.all()).filter((model) => model.providerID === ProviderV2.ID.githubCopilot)
      loaded.models = yield* Effect.tryPromise({
        try: () =>
          CopilotModels.get(
            loaded.baseURL ?? baseURL(),
            {
              ...provider?.headers,
              Authorization: `Bearer ${credential.refresh}`,
              "User-Agent": `opencode/${InstallationVersion}`,
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
      draft.method.update(oauth)
    })
    yield* ctx.catalog.transform((evt) => {
      const item = evt.provider.get(ProviderV2.ID.githubCopilot)
      if (!item) return
      if (loaded.models) {
        for (const id of item.models.keys()) {
          if (!loaded.models.has(ModelV2.ID.make(id))) evt.model.remove(item.provider.id, id)
        }
        for (const [id, model] of loaded.models) {
          evt.model.update(item.provider.id, id, (draft) => Object.assign(draft, structuredClone(model)))
        }
      } else if (loaded.baseURL) {
        for (const id of item.models.keys()) {
          evt.model.update(item.provider.id, id, (model) => {
            model.settings = ProviderV2.mergeOverlay(model.settings, { baseURL: loaded.baseURL })
          })
        }
      }
      if (item.models.has(ModelV2.ID.make("gpt-5-chat-latest"))) {
        evt.model.update(item.provider.id, ModelV2.ID.make("gpt-5-chat-latest"), (model) => {
          // This chat-only alias conflicts with the Copilot GPT-5 Responses route,
          // so hide it only for Copilot rather than for every provider catalog.
          model.enabled = false
        })
      }
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("github-copilot")),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.githubCopilot) return
        if (evt.package !== "@ai-sdk/github-copilot" && evt.package !== "@ai-sdk/anthropic") return
        evt.options.fetch = copilotFetch(
          typeof evt.options.apiKey === "string" ? evt.options.apiKey : undefined,
          evt.options.fetch,
          evt.package === "@ai-sdk/anthropic",
        )
        if (evt.package === "@ai-sdk/anthropic") {
          evt.options.headers = {
            ...evt.options.headers,
            "anthropic-beta": "interleaved-thinking-2025-05-14",
          }
          const mod = yield* Effect.promise(() => import("@ai-sdk/anthropic"))
          evt.sdk = mod.createAnthropic(evt.options)
          return
        }
        const mod = yield* Effect.promise(() => import("../../github-copilot/copilot-provider"))
        evt.sdk = mod.createOpenaiCompatible(evt.options)
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.githubCopilot) return
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
        evt.language = shouldUseResponses(id) ? evt.sdk.responses(id) : evt.sdk.chat(id)
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

function headers() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": `opencode/${InstallationVersion}`,
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

export function copilotFetch(token: string | undefined, upstream: Fetch | undefined, anthropic: boolean): Fetch {
  const send = upstream ?? fetch
  return async (input, init) => {
    const requestHeaders = new Headers(init?.headers)
    if (token) {
      requestHeaders.delete("authorization")
      requestHeaders.delete("x-api-key")
      requestHeaders.set("Authorization", `Bearer ${token}`)
    }
    requestHeaders.set("User-Agent", `opencode/${InstallationVersion}`)
    requestHeaders.set("Openai-Intent", "conversation-edits")
    requestHeaders.set("X-GitHub-Api-Version", apiVersion)
    if (anthropic) requestHeaders.set("anthropic-beta", "interleaved-thinking-2025-05-14")

    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url
    const body = typeof init?.body === "string" ? Option.getOrUndefined(decodeBody(init.body)) : undefined
    const metadata = requestMetadata(url, body)
    requestHeaders.set("x-initiator", metadata.agent ? "agent" : "user")
    if (metadata.vision) requestHeaders.set("Copilot-Vision-Request", "true")
    return send(input, { ...init, headers: requestHeaders })
  }
}

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
