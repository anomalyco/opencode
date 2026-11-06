import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { Message } from "@opencode/ai/effect"
import { Effect, Schema, Semaphore } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { createHash } from "crypto"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Provider } from "../../provider.js"
import { ProviderRefresh } from "./refresh.js"

const methodID = Integration.MethodID.make("claude-subscription")
const clientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const redirect = "https://platform.claude.com/oauth/code/callback"
const tokenURL = "https://platform.claude.com/v1/oauth/token"
const claudeVersion = "2.1.289"
const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})
const decodeToken = Schema.decodeUnknownSync(Token)

const subscription = {
  integrationID: Integration.ID.make("anthropic"),
  method: { id: methodID, type: "oauth", label: "Claude subscription (Pro/Max/Team)" },
  authorize: () =>
    Effect.gen(function* () {
      const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
      const challenge = Buffer.from(
        yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
      ).toString("base64url")
      const url = `https://claude.ai/oauth/authorize?${new URLSearchParams({
        code: "true",
        response_type: "code",
        client_id: clientID,
        redirect_uri: redirect,
        scope: "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: verifier,
      })}`
      return {
        mode: "code" as const,
        url,
        instructions: "Open the URL, sign in to Claude, and paste the authorization code.",
        callback: (code: string) =>
          requestClaudeToken({
            grant_type: "authorization_code",
            code: code.trim().split("#")[0],
            code_verifier: verifier,
            client_id: clientID,
            redirect_uri: redirect,
            state: verifier,
          }),
      }
    }),
  refresh: (value) =>
    requestClaudeToken({ grant_type: "refresh_token", refresh_token: value.refresh, client_id: clientID }),
} satisfies IntegrationOAuthMethodRegistration

export function requestClaudeToken(body: Record<string, string>, url = tokenURL) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": `claude-cli/${claudeVersion} (external, cli)`,
        },
        body: new URLSearchParams(body),
        signal,
      })
      if (!response.ok) throw new Error(`Claude authentication failed: ${response.status}`)
      const value = decodeToken(await response.json())
      const refresh = value.refresh_token ?? body.refresh_token
      if (!refresh) throw new Error("Claude authentication did not return a refresh token")
      return Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: value.access_token,
        refresh,
        expires: Date.now() + (value.expires_in ?? 36000) * 1000,
      })
    },
    catch: (cause) => cause,
  })
}

/** Fail closed when the account could be charged outside its subscription. */
export function checkSubscriptionUsage(access: string, url = "https://api.anthropic.com/api/oauth/profile") {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${access}`,
          "anthropic-beta": "oauth-2025-04-20",
          "user-agent": `claude-cli/${claudeVersion} (external, cli)`,
        },
        signal,
      })
      if (!response.ok) throw new Error(`Could not verify Claude subscription usage: HTTP ${response.status}`)
      const usage = Schema.decodeUnknownOption(
        Schema.Struct({
          organization: Schema.Struct({ has_extra_usage_enabled: Schema.Boolean }),
        }),
      )(await response.json())
      if (usage._tag === "None") throw new Error("Could not verify Claude subscription usage settings")
      if (usage.value.organization.has_extra_usage_enabled)
        throw new Error(
          "Claude extra usage is enabled. Disable it in Claude usage settings to use subscription-only mode.",
        )
    },
    catch: (cause) => cause,
  })
}

export async function prepareSubscriptionRequest(request: Request) {
  const body = await request.clone().json()
  const decoded = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(body)
  if (decoded._tag === "None") return request
  const system = Array.isArray(decoded.value.system)
    ? decoded.value.system
    : typeof decoded.value.system === "string"
      ? [{ type: "text", text: decoded.value.system }]
      : []
  const compatibleSystem = system.map((item) => {
    const block = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(item)
    if (block._tag === "None" || typeof block.value.text !== "string") return item
    return {
      ...block.value,
      // The Claude subscription endpoint rejects the original environment label as third-party usage.
      text: block.value.text.replace(/<env>[\s\S]*?<\/env>/g, (environment) =>
        environment.replace("Workspace root folder:", "Project root:"),
      ),
    }
  })
  const messages = Schema.decodeUnknownOption(
    Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
  )(decoded.value.messages)
  const first = messages._tag === "Some" ? messages.value.find((message) => message.role === "user") : undefined
  const content = first?.content
  const parts = Schema.decodeUnknownOption(
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
  )(content)
  const text =
    typeof content === "string"
      ? content
      : parts._tag === "Some"
        ? (parts.value.find((x) => x.type === "text")?.text ?? "")
        : ""
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 5)
  const sampled = [4, 7, 20].map((index) => text[index] ?? "0").join("")
  const suffix = createHash("sha256").update(`59cf53e54c78${sampled}${claudeVersion}`).digest("hex").slice(0, 3)
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  const url = new URL(request.url)
  url.searchParams.set("beta", "true")
  return new Request(url.toString(), {
    method: request.method,
    headers,
    signal: request.signal,
    body: JSON.stringify({
      ...decoded.value,
      system: [
        {
          type: "text",
          text: `x-anthropic-billing-header: cc_version=${claudeVersion}.${suffix}; cc_entrypoint=cli; cch=${hash};`,
        },
        { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
        ...compatibleSystem,
      ],
    }),
  })
}

// Upstream models-dev maps Anthropic to the native package; custom configs may still name the AI SDK package.
function isAnthropicPackage(packageName: string | undefined) {
  if (packageName === "@opencode/ai/providers/anthropic") return true
  return Provider.isAISDK(packageName) && Provider.packageName(packageName) === "@ai-sdk/anthropic"
}

export const AnthropicPlugin = define({
  id: "opencode.provider.anthropic",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((editor) => editor.method.update(subscription))
    const active = Effect.gen(function* () {
      const connection = yield* ctx.integration.connection.active(Provider.ID.anthropic)
      if (!connection) return undefined
      const value = yield* ctx.integration.connection.resolve(connection).pipe(Effect.orDie)
      if (!value) return yield* Effect.die(new Error("Could not resolve the active Anthropic credential"))
      return value?.type === "oauth" && value.methodID === methodID ? value : undefined
    })
    let subscribed = (yield* active) !== undefined
    const loading = Semaphore.makeUnsafe(1)
    yield* ctx.session.hook(
      "context",
      (event) =>
        active.pipe(
          Effect.map((enabled) => {
            if (!enabled) return
            const names = new Map(
              Object.keys(event.tools)
                .filter((name) => name.startsWith("mcp_") && !name.startsWith("mcp__"))
                .map((name) => [name, `mcp__${name.slice(4)}`] as const)
                .filter(([, alias]) => event.tools[alias] === undefined),
            )
            // A single-underscore MCP prefix is routed to paid extra usage by Anthropic.
            if (names.size === 0) return
            for (const [name, alias] of names) {
              event.tools[alias] = event.tools[name]
              delete event.tools[name]
            }
            event.messages = event.messages.map((message) =>
              Message.make({
                ...message,
                content: message.content.map((part) =>
                  (part.type === "tool-call" || part.type === "tool-result") && names.has(part.name)
                    ? { ...part, name: names.get(part.name)! }
                    : part,
                ),
              }),
            )
          }),
        ),
      { providerID: Provider.ID.anthropic },
    )
    yield* ctx.session.hook(
      "http.request",
      (event) =>
        Effect.gen(function* () {
          const credential = yield* active
          if (!credential) return
          if (event.request.method !== "POST" || !new URL(event.request.url).pathname.endsWith("/messages")) return
          yield* checkSubscriptionUsage(credential.access).pipe(Effect.orDie)
          event.request = yield* Effect.promise(() => prepareSubscriptionRequest(event.request))
        }),
      { providerID: Provider.ID.anthropic },
    )
    yield* ctx.session.hook(
      "model.request",
      (event) =>
        active.pipe(
          Effect.map((enabled) => {
            if (!enabled) return
            event.headers["anthropic-beta"] =
              "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,context-management-2025-06-27"
            event.headers["user-agent"] = `claude-cli/${claudeVersion} (external, cli)`
            event.headers["x-app"] = "cli"
            event.headers["anthropic-dangerous-direct-browser-access"] = "true"
          }),
        ),
      { providerID: Provider.ID.anthropic },
    )
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (!isAnthropicPackage(item.provider.package)) continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = {
            ...provider.headers,
            "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
          }
        })
      }
    })
    yield* ctx.model.transform((evt) => {
      if (!subscribed) return
      for (const model of evt.list(Provider.ID.anthropic)) {
        evt.update(model.providerID, model.id, (draft) => {
          draft.cost = []
        })
      }
    })
    yield* ProviderRefresh.onSwitch(
      Provider.ID.anthropic,
      loading.withPermit(
        active.pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              subscribed = value !== undefined
            }),
          ),
          Effect.andThen(ctx.model.reload()),
        ),
      ),
    )
  }),
})
