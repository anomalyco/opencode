import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"

// freemodel.dev is a single gateway, reached with one API key, that serves two
// request formats from the same account:
//   - Anthropic (Claude Code) at cc.freemodel.dev      → /v1/messages
//   - OpenAI   (Codex)        at api.freemodel.dev      → /v1/chat/completions, /v1/responses
// Each format has a free node and a faster T1+ node. The catalog ships one
// `freemodel` provider whose models carry their own npm + api host (Anthropic
// vs OpenAI), so a single login exposes both model families. The free hosts are
// the per-model api urls in the catalog; the loader never sets a provider-level
// baseURL (that would override every model's url), and instead hands the client
// a fetch wrapper that (a) upgrades the host to the T1+ node when that tier was
// chosen and (b) signs + scrubs Anthropic requests so they pass the gate.
const HOSTS = {
  // free host -> T1+ host
  "cc.freemodel.dev": "api-cc.freemodel.dev",
  "api.freemodel.dev": "vip-sg.freemodel.dev",
} as const

const ANTHROPIC_HOSTS = new Set(["cc.freemodel.dev", "api-cc.freemodel.dev"])

type Tier = "free" | "t1"

// The gate accepts metadata.user_id only when it is a JSON string carrying a
// session_id (the Claude Code CLI shape). Treat any other value as missing.
function isClaudeCodeUserId(value: unknown): boolean {
  if (typeof value !== "string") return false
  try {
    const parsed = JSON.parse(value)
    return !!parsed && typeof parsed === "object" && typeof parsed.session_id === "string"
  } catch {
    return false
  }
}

// opencode's system prompt advertises a `Workspace root folder:` line in its
// <env> block. That key does not exist in the Claude Code CLI prompt, and the
// freemodel Anthropic node fingerprints it: a body carrying that line is
// rejected with `400 {"type":"upstream_error"}`, while the identical body with
// the line removed is served normally. Strip it so Anthropic requests pass.
const WORKSPACE_ROOT_LINE = /\n[ \t]*Workspace root folder:[^\n]*/g

function scrubSystem(value: unknown): unknown {
  if (typeof value === "string") return value.replace(WORKSPACE_ROOT_LINE, "")
  if (Array.isArray(value))
    return value.map((block) =>
      block && typeof block === "object" && typeof (block as any).text === "string"
        ? { ...block, text: (block as any).text.replace(WORKSPACE_ROOT_LINE, "") }
        : block,
    )
  return value
}

// The Anthropic nodes gate non-CLI traffic, returning 200 with
// {"text":"Please use Claude Code CLI"} unless the request body carries a
// metadata.user_id that is a JSON string containing a session_id — the same
// shape the official Claude Code CLI sends. The OpenAI nodes have no gate.
function makeFetch(tier: Tier): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const sessionID = randomUUID()
  const userId = JSON.stringify({ device_id: "", account_uuid: "", session_id: sessionID })

  return async (input, init) => {
    let url: URL | undefined
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url
    try {
      url = new URL(raw)
    } catch {}

    if (url && tier === "t1") {
      const upgraded = HOSTS[url.hostname as keyof typeof HOSTS]
      if (upgraded) {
        url.hostname = upgraded
        input = typeof input === "string" || input instanceof URL ? url : new Request(url, input as Request)
      }
    }

    // For Anthropic requests: sign with a Claude Code CLI metadata.user_id and
    // strip the env line the gate fingerprints.
    if (url && ANTHROPIC_HOSTS.has(url.hostname) && init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body)
        if (body && typeof body === "object") {
          let changed = false
          if (!isClaudeCodeUserId(body.metadata?.user_id)) {
            body.metadata = { ...body.metadata, user_id: userId }
            changed = true
          }
          if (body.system !== undefined) {
            const scrubbed = scrubSystem(body.system)
            if (scrubbed !== body.system) {
              body.system = scrubbed
              changed = true
            }
          }
          if (changed) init = { ...init, body: JSON.stringify(body) }
        }
      } catch {}
    }

    return fetch(input, init)
  }
}

export async function FreeModelAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "freemodel",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "api") return {}
        const tier = (auth.metadata?.tier as Tier) ?? "free"
        // No baseURL: each model keeps its own catalog api host (Anthropic vs
        // OpenAI). The fetch wrapper handles tier upgrades and the gate.
        return {
          apiKey: auth.key,
          fetch: makeFetch(tier),
        }
      },
      methods: [
        {
          type: "api",
          label: "API key",
          prompts: [
            {
              type: "select",
              key: "tier",
              message: "Select FreeModel endpoint tier",
              options: [
                { label: "Free", value: "free", hint: "cc.freemodel.dev / api.freemodel.dev" },
                { label: "T1+", value: "t1", hint: "api-cc.freemodel.dev / vip-sg.freemodel.dev" },
              ],
            },
          ],
        },
      ],
    },
  }
}
