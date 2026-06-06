import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Model } from "@opencode-ai/sdk/v2"
import * as Log from "@opencode-ai/core/util/log"
import { readSession, refresh, expiryMs } from "./keychain"
import {
  catalog,
  dynamicCatalog,
  gatedFetch,
  loadProject,
  translateRequest,
  unwrapJson,
  unwrapSse,
  AGY_USER_AGENT,
  PROVIDER_ID,
} from "./models"

const log = Log.create({ service: "plugin.antigravity" })

// Refresh a little early so a long tool call doesn't 401 mid-flight.
const TOKEN_SKEW_MS = 120_000

// Connector for Google's Antigravity CLI (`agy`). Reuses agy's existing OS-keychain
// sign-in (no separate login), and routes Gemini inference through the Code Assist
// backend (cloudcode-pa v1internal) by wrapping @ai-sdk/google requests in the
// expected envelope. See ./models for the translation and ./keychain for auth.
export async function AntigravityAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    provider: {
      id: PROVIDER_ID,
      name: "Antigravity",
      async models(_provider, ctx): Promise<Record<string, Model>> {
        // Only expose models once the agy session has been connected.
        if (ctx.auth?.type !== "oauth") return {}
        try {
          // Discover the live model list (retrieveUserQuota) using the stored token.
          let access = ctx.auth.access
          if (!access || Date.now() >= ctx.auth.expires - TOKEN_SKEW_MS) {
            access = (await refresh(ctx.auth.refresh)).access
          }
          const project = await loadProject(access)
          return await dynamicCatalog(access, project)
        } catch (err) {
          log.error("antigravity model discovery failed; using static catalog", { error: String(err) })
          return catalog()
        }
      },
    },
    auth: {
      provider: PROVIDER_ID,
      async loader(getAuth) {
        const info = await getAuth()
        if (!info || info.type !== "oauth") return {}

        const oauthInfo = info
        let access = oauthInfo.access
        let expires = oauthInfo.expires
        let project: string | undefined

        async function token(): Promise<string> {
          if (!access || Date.now() >= expires - TOKEN_SKEW_MS) {
            const next = await refresh(oauthInfo.refresh)
            access = next.access
            expires = next.expires
          }
          return access
        }

        async function ensureProject(): Promise<string> {
          if (!project) project = await loadProject(await token())
          return project
        }

        return {
          apiKey: "",
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            const url = request instanceof URL ? request.href : typeof request === "string" ? request : request.url
            const t = await token()

            const bodyText =
              typeof init?.body === "string" ? init.body : init?.body == null ? undefined : String(init.body)
            const translated = translateRequest(url, bodyText, await ensureProject())

            // Not a generate call (e.g. token counting) — forward with bearer auth.
            if (!translated) {
              const headers = new Headers(init?.headers)
              headers.set("Authorization", `Bearer ${t}`)
              headers.delete("x-goog-api-key")
              return fetch(request, { ...init, headers })
            }

            const res = await gatedFetch(translated.url, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, "User-Agent": AGY_USER_AGENT },
              body: translated.body,
            })
            if (!res.ok) {
              log.error("antigravity generate failed", { status: res.status })
              return res
            }
            return translated.streaming ? unwrapSse(res) : await unwrapJson(res)
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Antigravity (use existing agy sign-in)",
          async authorize() {
            // Import the session agy already established in the OS keychain.
            const session = await readSession()
            const tok = session.token
            return {
              url: "https://antigravity.google",
              instructions: "Using your existing Antigravity CLI (agy) session from the system keychain.",
              method: "auto" as const,
              async callback() {
                return {
                  type: "success" as const,
                  refresh: tok.refresh_token,
                  access: tok.access_token,
                  expires: expiryMs(tok),
                }
              },
            }
          },
        },
      ],
    },
  }
}
