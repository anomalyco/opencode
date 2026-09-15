const providers = [
  "opencode",
  "opencode-go",
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

export function useServerSDK() {
  return () => ({ client })
}
