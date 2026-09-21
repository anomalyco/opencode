const providers = [
  "opencode-go",
  "opencode",
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "vercel",
  "github-copilot",
  "302ai",
  "abacus",
  "abliteration",
  "alibaba",
  "alibaba-cn",
  "alibaba-coding-plan",
]

const client = {
  provider: {
    auth: async () => ({
      data: Object.fromEntries(providers.map((provider) => [provider, [{ type: "api", label: "API key" }]])),
    }),
    oauth: {
      authorize: async (input: { method?: number }) => ({
        data: {
          url: "https://example.com/oauth",
          method: input.method === 1 ? ("code" as const) : ("auto" as const),
          instructions: input.method === 1 ? "Paste the authorization code" : "Confirmation code: ABCD-EFGH",
        },
      }),
      callback: async (input: { method?: number }) => {
        if (input.method === 0) return new Promise<never>(() => {})
        return { data: undefined }
      },
    },
  },
  auth: {
    set: async () => ({ data: true }),
  },
  global: {
    dispose: async () => ({ data: true }),
  },
}

const api = {
  form: {
    reply: async () => ({ data: true }),
    cancel: async () => ({ data: true }),
  },
  worktree: {
    list: async () => [],
    refresh: async () => [],
  },
}

const event = {
  listen: () => () => undefined,
  location: () => ({ on: () => () => undefined }),
}

const server = { type: "http" as const, http: { url: "http://storybook.local" } }

type ExecutionTransportOverride = {
  rpc: (...args: unknown[]) => unknown
  listen: (handler: (event: unknown) => void) => () => void
  status: () => string
}

function executionTransport() {
  return (globalThis as { __opencodeExecutionTransport?: ExecutionTransportOverride }).__opencodeExecutionTransport
}

export function useServerSDK() {
  const override = executionTransport()
  return {
    server,
    scope: ServerScope.local,
    url: "http://storybook.local",
    api: override ? { ...api, rpc: override.rpc } : api,
    client,
    event: override
      ? {
          on: () => () => undefined,
          listen: override.listen,
          location: () => ({ on: () => () => undefined, listen: () => () => undefined }),
        }
      : event,
    connection: { status: override ? override.status : () => "connected" },
  }
}
import { ServerScope } from "@/runtime/server/scope"
