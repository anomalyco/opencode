const token = "dummy-wellknown-token"
const port = Number(process.env.PORT ?? 8787)
const config = {
  $schema: "https://opencode.ai/config.json",
  share: "manual",
  model: "example-primary/example-chat",
  enabled_providers: ["example-primary", "example-secondary"],
  disabled_providers: ["opencode", "anthropic", "openai", "google", "xai", "amazon-bedrock", "azure"],
  provider: {
    "example-primary": {
      name: "Example Primary",
      npm: "@ai-sdk/openai-compatible",
      whitelist: ["example-chat", "example-code"],
      options: {
        baseURL: "https://models.example.com/v1",
        apiKey: "{env:TOKEN}",
      },
      models: {
        "example-chat": {
          name: "Example Chat",
          reasoning: true,
          tool_call: true,
          attachment: true,
          modalities: {
            input: ["text", "image"],
            output: ["text"],
          },
          limit: {
            context: 128000,
            output: 16000,
          },
        },
        "example-code": {
          name: "Example Code",
          reasoning: true,
          tool_call: true,
          limit: {
            context: 200000,
            output: 32000,
          },
        },
      },
    },
    "example-secondary": {
      name: "Example Secondary",
      npm: "@ai-sdk/openai-compatible",
      whitelist: ["example-fast"],
      options: {
        baseURL: "https://inference.example.org/v1",
        apiKey: "{env:TOKEN}",
      },
      models: {
        "example-fast": {
          name: "Example Fast",
          tool_call: true,
          limit: {
            context: 64000,
            output: 8000,
          },
        },
      },
    },
  },
  mcp: {
    "example-tools": {
      type: "remote",
      url: "https://tools.example.net/mcp",
      enabled: false,
    },
  },
  permission: {
    bash: "ask",
    edit: "ask",
    webfetch: "ask",
    read: {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
    },
  },
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/.well-known/opencode") {
      return Response.json({
        auth: {
          command: ["bun", "-e", `await Bun.sleep(5000); process.stdout.write(${JSON.stringify(token)})`],
          env: "TOKEN",
        },
        remote_config: {
          url: `${url.origin}/config/opencode.json`,
          headers: { authorization: "Bearer {env:TOKEN}" },
        },
      })
    }
    if (url.pathname === "/config/opencode.json") {
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("Unauthorized", { status: 401 })
      }
      return Response.json(config)
    }
    return new Response("Not found", { status: 404 })
  },
})

console.log(`Well-known fixture listening at ${server.url.origin}`)
console.log(`Test with: bun run dev auth connect ${server.url.origin}`)
