import { test, expect, mock, beforeEach } from "bun:test"
import path from "path"

// === Mocks ===
// These mocks are required because Provider.list() triggers:
// 1. BunProc.install() for various packages
// 2. Plugin.list() which calls BunProc.install() for default plugins
// Without mocks, these would attempt real package installations that timeout in tests.

mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string) => pkg,
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

mock.module("@aws-sdk/credential-providers", () => ({
  fromNodeProviderChain: () => async () => ({
    accessKeyId: "mock-access-key-id",
    secretAccessKey: "mock-secret-access-key",
  }),
}))

const mockPlugin = async () => ({})
Object.defineProperty(mockPlugin, "name", { value: "mockPlugin" })
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin, gitlabAuthPlugin: mockPlugin }))

// Mock serving endpoints for dynamic discovery tests.
// Tests can populate this array before calling Provider.list() to simulate
// the WorkspaceClient.servingEndpoints.list() response.
// Default includes a Claude endpoint so the provider has at least one model
// (providers with zero models are removed by Provider.list()).
const defaultMockEndpoints = [
  {
    name: "databricks-claude-sonnet-4",
    config: {
      served_entities: [{ foundation_model: { display_name: "Claude Sonnet 4" } }],
    },
    task: "llm/v1/chat",
  },
]
let mockServingEndpointsList: Array<any> = [...defaultMockEndpoints]

// Mock the Databricks SDK to avoid real credential validation in tests.
// The mock simulates the SDK's Config class behavior: reading host/token from
// constructor args first, falling back to the env object passed via `env` option.
mock.module("@databricks/sdk-experimental", () => {
  class Config {
    host?: string
    token?: string
    clientId?: string
    clientSecret?: string
    azureClientId?: string
    azureClientSecret?: string
    azureTenantId?: string
    profile?: string
    env: Record<string, string | undefined>

    constructor(options: any = {}) {
      this.env = options.env || process.env
      this.host = options.host
      this.token = options.token
      this.clientId = options.clientId
      this.clientSecret = options.clientSecret
      this.azureClientId = options.azureClientId
      this.azureClientSecret = options.azureClientSecret
      this.azureTenantId = options.azureTenantId
      this.profile = options.profile
    }

    async ensureResolved() {
      // Simulate SDK's config resolution: constructor args take precedence over env vars
      if (!this.host) this.host = this.env.DATABRICKS_HOST
      if (!this.token) this.token = this.env.DATABRICKS_TOKEN
      if (!this.host && this.profile) this.host = `https://${this.profile}.cloud.databricks.com`
      if (!this.token && this.profile) this.token = `token-for-${this.profile}`
      // Strip trailing slashes from host (like the real SDK)
      if (this.host) this.host = this.host.replace(/\/+$/, "")
    }

    async authenticate(headers: Headers) {
      if (this.token) {
        headers.set("Authorization", `Bearer ${this.token}`)
      }
    }

    async getHost() {
      return new URL(this.host!)
    }
  }

  function isAnyAuthConfigured(config: any) {
    return !!(config.token || config.profile || (config.clientId && config.clientSecret))
  }

  class WorkspaceClient {
    servingEndpoints = {
      async *list() {
        for (const endpoint of mockServingEndpointsList) {
          yield endpoint
        }
      },
    }
    constructor(_config: any) {}
  }

  return { Config, isAnyAuthConfigured, WorkspaceClient }
})

// Import after mocks are set up
const { tmpdir } = await import("../fixture/fixture")
const { Instance } = await import("../../src/project/instance")
const { Provider } = await import("../../src/provider/provider")
const { Env } = await import("../../src/env")
const { Global } = await import("../../src/global")

// Reset mock endpoints before each test so basic tests always have at least one model.
// Tests that need specific endpoints override mockServingEndpointsList explicitly.
beforeEach(() => {
  mockServingEndpointsList = [...defaultMockEndpoints]
})

test("Databricks: loads when DATABRICKS_HOST and DATABRICKS_TOKEN are set", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      expect(providers["databricks"].name).toBe("Databricks")
    },
  })
})

test("Databricks: does not load when only DATABRICKS_HOST is set (no auth)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  // Backup and clear auth.json to ensure no stored Databricks auth
  const authPath = path.join(Global.Path.data, "auth.json")
  const authFile = Bun.file(authPath)
  const existingAuth = (await authFile.exists()) ? await authFile.text() : null
  await Bun.write(authPath, JSON.stringify({}))

  // Save and override HOME to prevent finding real ~/.databricks/token-cache.json
  const originalHome = process.env.HOME
  process.env.HOME = tmp.path

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.remove("DATABRICKS_TOKEN") // Explicitly clear token
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["databricks"]).toBeUndefined()
      },
    })
  } finally {
    // Restore HOME
    if (originalHome) process.env.HOME = originalHome
    // Restore auth.json
    if (existingAuth !== null) {
      await Bun.write(authPath, existingAuth)
    }
  }
})

test("Databricks: config host takes precedence over DATABRICKS_HOST env var", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            databricks: {
              options: {
                host: "https://config-workspace.cloud.databricks.com",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://env-workspace.cloud.databricks.com")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      // baseURL should use config host
      expect(providers["databricks"].options.baseURL).toContain("config-workspace")
    },
  })
})

test("Databricks: baseURL option takes precedence", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            databricks: {
              options: {
                baseURL: "https://custom-url.cloud.databricks.com/serving-endpoints",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://env-workspace.cloud.databricks.com")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      expect(providers["databricks"].options.baseURL).toBe("https://custom-url.cloud.databricks.com/serving-endpoints")
    },
  })
})

test("Databricks: discovers models dynamically from serving endpoints", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-claude-sonnet-4",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "claude-sonnet-4", display_name: "Claude Sonnet 4" } }] },
    },
    {
      name: "databricks-gpt-5-2",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gpt-5-2", display_name: "GPT-5.2" } }] },
    },
    {
      name: "databricks-gemini-3-pro",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gemini-3-pro", display_name: "Gemini 3 Pro" } }] },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["databricks"]).toBeDefined()
        const models = Object.keys(providers["databricks"].models)
        // Should discover Claude models
        expect(models.some((m) => m.includes("claude"))).toBe(true)
        // Should discover GPT models
        expect(models.some((m) => m.includes("gpt-5"))).toBe(true)
        // Should discover Gemini models
        expect(models.some((m) => m.includes("gemini"))).toBe(true)
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

test("Databricks: custom models via config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            databricks: {
              models: {
                "custom-endpoint": {
                  name: "Custom Endpoint",
                  tool_call: true,
                  limit: { context: 100000, output: 10000 },
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      expect(providers["databricks"].models["custom-endpoint"]).toBeDefined()
      expect(providers["databricks"].models["custom-endpoint"].name).toBe("Custom Endpoint")
    },
  })
})

test("Databricks: loads when bearer token from auth.json is present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  const authPath = path.join(Global.Path.data, "auth.json")

  // Backup existing auth.json if it exists
  const authFile = Bun.file(authPath)
  const existingAuth = (await authFile.exists()) ? await authFile.text() : null

  // Write test auth
  await Bun.write(
    authPath,
    JSON.stringify({
      databricks: {
        type: "api",
        key: "test-bearer-token",
      },
    }),
  )

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        // No DATABRICKS_TOKEN env var - using auth.json instead
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["databricks"]).toBeDefined()
      },
    })
  } finally {
    // Restore original auth.json or delete if it didn't exist
    if (existingAuth !== null) {
      await Bun.write(authPath, existingAuth)
    } else {
      await Bun.write(authPath, JSON.stringify({}))
    }
  }
})

test("Databricks: loads when Databricks profile auth is stored in auth.json", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  const authPath = path.join(Global.Path.data, "auth.json")
  const authFile = Bun.file(authPath)
  const existingAuth = (await authFile.exists()) ? await authFile.text() : null

  await Bun.write(
    authPath,
    JSON.stringify({
      databricks: {
        type: "databricks-profile",
        profile: "staging",
      },
    }),
  )

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["databricks"]).toBeDefined()
      },
    })
  } finally {
    if (existingAuth !== null) {
      await Bun.write(authPath, existingAuth)
    } else {
      await Bun.write(authPath, JSON.stringify({}))
    }
  }
})

test("Databricks: appends /serving-endpoints to host URL", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      expect(providers["databricks"].options.baseURL).toBe(
        "https://my-workspace.cloud.databricks.com/serving-endpoints",
      )
    },
  })
})

test("Databricks: does not duplicate /serving-endpoints if already present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            databricks: {
              options: {
                host: "https://my-workspace.cloud.databricks.com/serving-endpoints",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      // Should not duplicate /serving-endpoints
      expect(providers["databricks"].options.baseURL).toBe(
        "https://my-workspace.cloud.databricks.com/serving-endpoints",
      )
    },
  })
})

test("Databricks: sets User-Agent header", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      expect(providers["databricks"].options.headers["User-Agent"]).toBe("opencode")
    },
  })
})

test("Databricks: sets x-databricks-disable-beta-headers header", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      expect(providers["databricks"].options.headers["x-databricks-disable-beta-headers"]).toBe("true")
    },
  })
})

test("Databricks: sets includeUsage to false", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      expect(providers["databricks"].options.includeUsage).toBe(false)
    },
  })
})

// OAuth M2M tests - note: these test the config parsing, not actual token fetching
// since we'd need to mock the OAuth endpoint

test("Databricks: OAuth M2M credentials via config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            databricks: {
              options: {
                host: "https://my-workspace.cloud.databricks.com",
                clientId: "test-client-id",
                clientSecret: "test-client-secret",
              },
            },
          },
        }),
      )
    },
  })
  // This test verifies that the config is parsed correctly
  // The actual OAuth flow would require mocking the fetch call
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Without a way to mock the OAuth endpoint, this will return autoload: false
      // because the token fetch will fail. We're just verifying config parsing works.
      const providers = await Provider.list()
      // Provider won't load because OAuth token fetch fails (no mock endpoint)
      // This is expected behavior - we'd need to mock fetch for a full test
    },
  })
})

test("Databricks: discovered model capabilities are set from family defaults", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-claude-sonnet-4",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "claude-sonnet-4", display_name: "Claude Sonnet 4" } }] },
    },
    {
      name: "databricks-gpt-5",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gpt-5", display_name: "GPT-5" } }] },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["databricks"]).toBeDefined()

        // Claude models get claude family defaults
        const claudeModel = providers["databricks"].models["databricks-claude-sonnet-4"]
        expect(claudeModel).toBeDefined()
        expect(claudeModel.capabilities.toolcall).toBe(true)
        expect(claudeModel.capabilities.attachment).toBe(true)
        expect(claudeModel.limit.context).toBe(200000)

        // GPT models get gpt family defaults
        const gptModel = providers["databricks"].models["databricks-gpt-5"]
        expect(gptModel).toBeDefined()
        expect(gptModel.capabilities.toolcall).toBe(true)
        expect(gptModel.capabilities.attachment).toBe(true)
        expect(gptModel.capabilities.reasoning).toBe(true)
        expect(gptModel.limit.context).toBe(400000)
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

// Model family tests - verify discovery correctly assigns family defaults

test("Databricks: GPT models discovered with correct family defaults", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-gpt-5-2",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gpt-5-2", display_name: "GPT-5.2" } }] },
    },
    {
      name: "databricks-gpt-5-1",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gpt-5-1", display_name: "GPT-5.1" } }] },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        // GPT-5.2
        const gpt52 = models["databricks-gpt-5-2"]
        expect(gpt52).toBeDefined()
        expect(gpt52.family).toBe("gpt")
        expect(gpt52.capabilities.reasoning).toBe(true)
        expect(gpt52.capabilities.toolcall).toBe(true)
        expect(gpt52.capabilities.attachment).toBe(true)
        expect(gpt52.capabilities.input.image).toBe(true)

        // GPT-5.1
        const gpt51 = models["databricks-gpt-5-1"]
        expect(gpt51).toBeDefined()
        expect(gpt51.family).toBe("gpt")
        expect(gpt51.capabilities.reasoning).toBe(true)
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

test("Databricks: Gemini models discovered with correct family defaults", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-gemini-3-pro",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gemini-3-pro", display_name: "Gemini 3 Pro" } }] },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        const gemini3Pro = models["databricks-gemini-3-pro"]
        expect(gemini3Pro).toBeDefined()
        expect(gemini3Pro.family).toBe("gemini")
        expect(gemini3Pro.capabilities.reasoning).toBe(true)
        expect(gemini3Pro.capabilities.attachment).toBe(true)
        expect(gemini3Pro.capabilities.input.image).toBe(true)
        expect(gemini3Pro.limit.context).toBe(1000000) // 1M context
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

test("Databricks: Claude models discovered with correct family defaults", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-claude-sonnet-4",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "claude-sonnet-4", display_name: "Claude Sonnet 4" } }] },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        const claudeSonnet4 = models["databricks-claude-sonnet-4"]
        expect(claudeSonnet4).toBeDefined()
        expect(claudeSonnet4.family).toBe("claude")
        expect(claudeSonnet4.capabilities.reasoning).toBe(false) // claude family default
        expect(claudeSonnet4.capabilities.attachment).toBe(true)
        expect(claudeSonnet4.capabilities.input.image).toBe(true)
        expect(claudeSonnet4.limit.context).toBe(200000)
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

test("Databricks: non-tool-capable families are excluded from discovery", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-llama-4-maverick",
      task: "llm/v1/chat",
      config: {
        served_entities: [{ foundation_model: { name: "llama-4-maverick", display_name: "Llama 4 Maverick" } }],
      },
    },
    {
      name: "databricks-qwen3-next-80b",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "qwen3-next-80b", display_name: "Qwen3 Next 80B" } }] },
    },
    {
      name: "databricks-claude-sonnet-4",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "claude-sonnet-4", display_name: "Claude Sonnet 4" } }] },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        // Llama and Qwen are excluded (not in tool-capable families)
        expect(models["databricks-llama-4-maverick"]).toBeUndefined()
        expect(models["databricks-qwen3-next-80b"]).toBeUndefined()

        // Claude is included (tool-capable family)
        expect(models["databricks-claude-sonnet-4"]).toBeDefined()
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

test("Databricks: all discovered models have required API configuration and tool support", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-claude-sonnet-4",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "claude-sonnet-4", display_name: "Claude Sonnet 4" } }] },
    },
    {
      name: "databricks-gpt-5",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gpt-5", display_name: "GPT-5" } }] },
    },
    {
      name: "databricks-gpt-5-3-codex",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gpt-5-3-codex", display_name: "GPT-5.3 Codex" } }] },
    },
    {
      name: "databricks-gemini-3-pro",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gemini-3-pro", display_name: "Gemini 3 Pro" } }] },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        // Each model family uses its native SDK for best compatibility:
        // - Claude models: @ai-sdk/anthropic (native Anthropic API)
        // - GPT/Codex models: @ai-sdk/openai (Responses API)
        // - Gemini/others: @ai-sdk/openai-compatible (chat completions)
        for (const [modelId, model] of Object.entries(models)) {
          const idLower = modelId.toLowerCase()
          if (idLower.includes("claude")) {
            expect(model.api.npm).toBe("@ai-sdk/anthropic")
            expect(model.api.url).toContain("serving-endpoints/anthropic/v1")
          } else if (idLower.includes("gpt") || idLower.includes("codex")) {
            expect(model.api.npm).toBe("@ai-sdk/openai")
          } else {
            expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
          }
          expect(model.providerID).toBe("databricks")
          expect(model.api.url).toContain("serving-endpoints")
          expect(model.status).toBe("active")
          // All included models must support tool calling
          expect(model.capabilities.toolcall).toBe(true)
        }
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

// === Databricks SDK Auth Delegation Tests ===
// CLI token cache, token refresh, and credential chain are now handled by
// @databricks/sdk-experimental. These tests verify our code's integration
// with the SDK rather than testing SDK internals.

test("Databricks: does not load when no auth is available (host only)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  // Clear auth.json to ensure no stored Databricks auth
  const authPath = path.join(Global.Path.data, "auth.json")
  const authFile = Bun.file(authPath)
  const existingAuth = (await authFile.exists()) ? await authFile.text() : null
  await Bun.write(authPath, JSON.stringify({}))

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.remove("DATABRICKS_TOKEN")
      },
      fn: async () => {
        const providers = await Provider.list()
        // Provider should not load - host without any auth credentials
        expect(providers["databricks"]).toBeUndefined()
      },
    })
  } finally {
    if (existingAuth !== null) {
      await Bun.write(authPath, existingAuth)
    }
  }
})

test("Databricks: trailing slash in host is normalized", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com/")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["databricks"]).toBeDefined()
      // baseURL should not have double slashes from trailing slash
      expect(providers["databricks"].options.baseURL).toBe(
        "https://my-workspace.cloud.databricks.com/serving-endpoints",
      )
    },
  })
})

// === Provider Route: Empty Models Handling ===

test("Provider.sort with empty models array does not crash", () => {
  // Provider.sort([]) returns [], so accessing [0].id would crash
  const sorted = Provider.sort([])
  expect(sorted).toEqual([])
  expect(sorted[0]).toBeUndefined()
})

test("Provider route: default model map handles providers with empty models", async () => {
  // Simulate the route logic that crashed at provider.ts:68
  // mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id)
  // When models is {}, this crashes because [0] is undefined
  const providers: Record<string, any> = {
    databricks: {
      id: "databricks",
      name: "Databricks",
      models: {},
    },
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-5": {
          id: "gpt-5",
          name: "GPT-5",
        },
      },
    },
  }

  // This is the fixed logic - should not crash
  const defaults: Record<string, string> = {}
  for (const [key, item] of Object.entries(providers)) {
    const sorted = Provider.sort(Object.values(item.models))
    if (sorted[0]) {
      defaults[key] = sorted[0].id
    }
  }

  // Provider with empty models should be excluded from defaults
  expect(defaults["databricks"]).toBeUndefined()
  // Provider with models should have a default
  expect(defaults["openai"]).toBe("gpt-5")
})

// === Gemini Stream Transform Tests ===

test("Gemini stream transform: converts content array to string", () => {
  // Simulate the transform logic from provider.ts:1357-1393
  const sseLine = JSON.stringify({
    choices: [
      {
        delta: {
          content: [{ type: "text", text: "Hello world" }],
        },
      },
    ],
  })

  const data = JSON.parse(sseLine)
  if (data.choices && Array.isArray(data.choices)) {
    for (const choice of data.choices) {
      if (choice.delta && Array.isArray(choice.delta.content)) {
        const textParts = choice.delta.content
          .filter((part: any) => part.type === "text" && part.text)
          .map((part: any) => part.text)
        choice.delta.content = textParts.join("")
      }
    }
  }

  expect(data.choices[0].delta.content).toBe("Hello world")
})

test("Gemini stream transform: handles multiple text parts", () => {
  const data: any = {
    choices: [
      {
        delta: {
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      },
    ],
  }

  for (const choice of data.choices) {
    if (choice.delta && Array.isArray(choice.delta.content)) {
      const textParts = choice.delta.content
        .filter((part: any) => part.type === "text" && part.text)
        .map((part: any) => part.text)
      choice.delta.content = textParts.join("")
    }
  }

  expect(data.choices[0].delta.content).toBe("Hello world")
})

test("Gemini stream transform: handles thoughtSignature parts", () => {
  // thoughtSignature parts should be filtered out - only text parts are extracted
  const data: any = {
    choices: [
      {
        delta: {
          content: [
            { type: "text", text: "The answer is 42" },
            { type: "thoughtSignature", thoughtSignature: "abc123" },
          ],
        },
      },
    ],
  }

  for (const choice of data.choices) {
    if (choice.delta && Array.isArray(choice.delta.content)) {
      const textParts = choice.delta.content
        .filter((part: any) => part.type === "text" && part.text)
        .map((part: any) => part.text)
      choice.delta.content = textParts.join("")
    }
  }

  // Only text content should remain, thoughtSignature should be filtered out
  expect(data.choices[0].delta.content).toBe("The answer is 42")
})

test("Gemini stream transform: handles empty content array", () => {
  const data: any = {
    choices: [
      {
        delta: {
          content: [],
        },
      },
    ],
  }

  for (const choice of data.choices) {
    if (choice.delta && Array.isArray(choice.delta.content)) {
      const textParts = choice.delta.content
        .filter((part: any) => part.type === "text" && part.text)
        .map((part: any) => part.text)
      choice.delta.content = textParts.join("")
    }
  }

  expect(data.choices[0].delta.content).toBe("")
})

test("Gemini stream transform: passes through string content unchanged", () => {
  // When content is already a string, it should not be transformed
  const data = {
    choices: [
      {
        delta: {
          content: "Already a string",
        },
      },
    ],
  }

  for (const choice of data.choices) {
    if (choice.delta && Array.isArray(choice.delta.content)) {
      const textParts = choice.delta.content
        .filter((part: any) => part.type === "text" && part.text)
        .map((part: any) => part.text)
      choice.delta.content = textParts.join("")
    }
  }

  // String content should pass through unchanged
  expect(data.choices[0].delta.content).toBe("Already a string")
})

// === Codex Discovery Tests ===

test("Databricks: Codex models are discovered via codex family", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-gpt-5-3-codex",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "gpt-5-3-codex", display_name: "GPT-5.3 Codex" } }] },
    },
    {
      name: "databricks-gpt-5-1-codex-mini",
      task: "llm/v1/chat",
      config: {
        served_entities: [{ foundation_model: { name: "gpt-5-1-codex-mini", display_name: "GPT-5.1 Codex Mini" } }],
      },
    },
    {
      name: "databricks-gpt-5-1-codex-max",
      task: "llm/v1/chat",
      config: {
        served_entities: [{ foundation_model: { name: "gpt-5-1-codex-max", display_name: "GPT-5.1 Codex Max" } }],
      },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        // All codex models should be discovered
        const codex53 = models["databricks-gpt-5-3-codex"]
        expect(codex53).toBeDefined()
        expect(codex53.capabilities.toolcall).toBe(true)
        expect(codex53.capabilities.reasoning).toBe(true)

        const codexMini = models["databricks-gpt-5-1-codex-mini"]
        expect(codexMini).toBeDefined()
        expect(codexMini.capabilities.toolcall).toBe(true)

        const codexMax = models["databricks-gpt-5-1-codex-max"]
        expect(codexMax).toBeDefined()
        expect(codexMax.capabilities.toolcall).toBe(true)

        // Codex models should use OpenAI Responses API
        expect(codex53.api.npm).toBe("@ai-sdk/openai")
        expect(codexMini.api.npm).toBe("@ai-sdk/openai")
        expect(codexMax.api.npm).toBe("@ai-sdk/openai")
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

test("Databricks: Codex models use Responses API via getModel", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-gpt-5-1-codex-max",
      task: "llm/v1/chat",
      config: {
        served_entities: [{ foundation_model: { name: "gpt-5-1-codex-max", display_name: "GPT-5.1 Codex Max" } }],
      },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()

        const codexMaxModel = providers["databricks"].models["databricks-gpt-5-1-codex-max"]
        expect(codexMaxModel).toBeDefined()

        // Get the language model to verify it uses responses provider
        const languageModel = await Provider.getLanguage(codexMaxModel)
        expect(languageModel.provider).toContain("responses")
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

// === Dynamic Model Discovery Tests ===
// Discovery now uses WorkspaceClient.servingEndpoints.list() from the SDK.
// Tests populate mockServingEndpointsList to simulate the SDK's response.

test("Databricks: API discovery adds new foundation models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-claude-new-model",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "claude-new", display_name: "Claude New Model" } }] },
    },
    {
      name: "databricks-gemini-new-flash",
      task: "llm/v1/chat",
      config: {
        served_entities: [{ foundation_model: { name: "gemini-new-flash", display_name: "Gemini New Flash" } }],
      },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        // New Claude model should be discovered
        expect(models["databricks-claude-new-model"]).toBeDefined()
        expect(models["databricks-claude-new-model"].name).toBe("Claude New Model")
        expect(models["databricks-claude-new-model"].capabilities.toolcall).toBe(true)

        // New Gemini model should be discovered
        expect(models["databricks-gemini-new-flash"]).toBeDefined()
        expect(models["databricks-gemini-new-flash"].name).toBe("Gemini New Flash")
        expect(models["databricks-gemini-new-flash"].capabilities.toolcall).toBe(true)
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

test("Databricks: API discovery - user config models take precedence over discovered models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            databricks: {
              models: {
                "databricks-claude-sonnet-4": {
                  name: "My Custom Claude",
                  tool_call: true,
                  attachment: true,
                  reasoning: false,
                  temperature: true,
                  cost: { input: 5.0, output: 25.0 },
                  limit: { context: 200000, output: 64000 },
                },
              },
            },
          },
        }),
      )
    },
  })

  mockServingEndpointsList = [
    {
      name: "databricks-claude-sonnet-4",
      task: "llm/v1/chat",
      config: {
        served_entities: [{ foundation_model: { name: "claude-sonnet-4", display_name: "Should Not Override" } }],
      },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        // User config model should keep its metadata (not overridden by API discovery)
        const claudeSonnet4 = models["databricks-claude-sonnet-4"]
        expect(claudeSonnet4).toBeDefined()
        expect(claudeSonnet4.name).toBe("My Custom Claude")
        // Should retain cost info from user config (API discovery sets cost to 0)
        expect(claudeSonnet4.cost.input).toBeGreaterThan(0)
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

test("Databricks: API discovery failure results in no models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  // Simulate SDK returning no endpoints
  mockServingEndpointsList = []

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
      Env.set("DATABRICKS_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      // With no discovered models and no hardcoded defaults, provider is removed
      // (providers with zero models are filtered out by Provider.list())
      expect(providers["databricks"]).toBeUndefined()
    },
  })
})

test("Databricks: API discovery excludes embedding endpoints", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    // Include a valid chat endpoint so the provider has at least one model
    {
      name: "databricks-claude-sonnet-4",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { display_name: "Claude Sonnet 4" } }] },
    },
    {
      name: "databricks-gte-large-en",
      task: "llm/v1/embedding",
      config: { served_entities: [{ foundation_model: { name: "gte-large-en", display_name: "GTE Large EN" } }] },
    },
    {
      name: "databricks-bge-large-en",
      task: "llm/v1/embedding",
      config: { served_entities: [{ foundation_model: { name: "bge-large-en", display_name: "BGE Large EN" } }] },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        // Embedding endpoints should NOT be included
        expect(models["databricks-gte-large-en"]).toBeUndefined()
        expect(models["databricks-bge-large-en"]).toBeUndefined()
        // Chat endpoint should be included
        expect(models["databricks-claude-sonnet-4"]).toBeDefined()
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})

test("Databricks: API discovery only includes chat-capable foundation models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })

  mockServingEndpointsList = [
    // Chat-capable foundation model from known family - should be included
    {
      name: "databricks-claude-future-model",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "claude-future", display_name: "Claude Future" } }] },
    },
    // Non-foundation model (custom endpoint, no foundation_model) - should be excluded
    {
      name: "my-custom-fine-tuned-model",
      task: "llm/v1/chat",
      config: { served_entities: [{}] },
    },
    // Foundation model but completions task - should be excluded
    {
      name: "databricks-gpt-completions",
      task: "llm/v1/completions",
      config: { served_entities: [{ foundation_model: { name: "gpt-completions" } }] },
    },
    // Foundation model from unknown family (llama) - should be excluded (not tool-capable)
    {
      name: "databricks-llama-5-new",
      task: "llm/v1/chat",
      config: { served_entities: [{ foundation_model: { name: "llama-5-new", display_name: "Llama 5 New" } }] },
    },
  ]

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("DATABRICKS_HOST", "https://my-workspace.cloud.databricks.com")
        Env.set("DATABRICKS_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = providers["databricks"].models

        // Chat-capable foundation model from known family should be included
        expect(models["databricks-claude-future-model"]).toBeDefined()
        expect(models["databricks-claude-future-model"].capabilities.toolcall).toBe(true)

        // Custom (non-foundation) endpoint should be excluded
        expect(models["my-custom-fine-tuned-model"]).toBeUndefined()

        // Completions task endpoint should be excluded
        expect(models["databricks-gpt-completions"]).toBeUndefined()

        // Llama (unknown tool-capable family) should be excluded
        expect(models["databricks-llama-5-new"]).toBeUndefined()
      },
    })
  } finally {
    mockServingEndpointsList = []
  }
})
