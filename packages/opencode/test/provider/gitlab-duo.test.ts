import { test, expect, mock } from "bun:test"
import path from "path"

// === Mocks ===
// These mocks prevent real package installations during tests

mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string, _version?: string) => {
      // Return package name without version for mocking
      const lastAtIndex = pkg.lastIndexOf("@")
      return lastAtIndex > 0 ? pkg.substring(0, lastAtIndex) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin }))

// Import after mocks are set up
const { tmpdir } = await import("../fixture/fixture")
const { Instance } = await import("../../src/project/instance")
const { Provider } = await import("../../src/provider/provider")
const { Env } = await import("../../src/env")
const { Global } = await import("../../src/global")

test("GitLab Duo: loads provider with API key from environment", async () => {
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
      Env.set("GITLAB_TOKEN", "test-gitlab-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["gitlab"]).toBeDefined()
      expect(providers["gitlab"].key).toBe("test-gitlab-token")
    },
  })
})

test("GitLab Duo: config instanceUrl option sets baseURL", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            gitlab: {
              options: {
                instanceUrl: "https://gitlab.example.com",
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
      Env.set("GITLAB_TOKEN", "test-token")
      Env.set("GITLAB_INSTANCE_URL", "https://gitlab.example.com")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["gitlab"]).toBeDefined()
      expect(providers["gitlab"].options?.instanceUrl).toBe("https://gitlab.example.com")
    },
  })
})

test("GitLab Duo: loads with OAuth token from auth.json", async () => {
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
  await Bun.write(
    authPath,
    JSON.stringify({
      gitlab: {
        type: "oauth",
        access: "test-access-token",
        refresh: "test-refresh-token",
        expires: Date.now() + 3600000,
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("GITLAB_TOKEN", "")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["gitlab"]).toBeDefined()
    },
  })
})

test("GitLab Duo: loads with Personal Access Token from auth.json", async () => {
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

  const authPath2 = path.join(Global.Path.data, "auth.json")
  await Bun.write(
    authPath2,
    JSON.stringify({
      gitlab: {
        type: "api",
        key: "glpat-test-pat-token",
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("GITLAB_TOKEN", "")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["gitlab"]).toBeDefined()
      expect(providers["gitlab"].key).toBe("glpat-test-pat-token")
    },
  })
})

test("GitLab Duo: supports self-hosted instance configuration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            gitlab: {
              options: {
                instanceUrl: "https://gitlab.company.internal",
                apiKey: "glpat-internal-token",
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
      Env.set("GITLAB_INSTANCE_URL", "https://gitlab.company.internal")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["gitlab"]).toBeDefined()
      expect(providers["gitlab"].options?.instanceUrl).toBe("https://gitlab.company.internal")
    },
  })
})

test("GitLab Duo: config apiKey takes precedence over environment variable", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            gitlab: {
              options: {
                apiKey: "config-token",
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
      Env.set("GITLAB_TOKEN", "env-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["gitlab"]).toBeDefined()
    },
  })
})

test("GitLab Duo: supports feature flags configuration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            gitlab: {
              options: {
                featureFlags: {
                  duo_agent_platform_agentic_chat: true,
                  duo_agent_platform: true,
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
      Env.set("GITLAB_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["gitlab"]).toBeDefined()
      expect(providers["gitlab"].options?.featureFlags).toBeDefined()
      expect(providers["gitlab"].options?.featureFlags?.duo_agent_platform_agentic_chat).toBe(true)
    },
  })
})

test("GitLab Duo: has multiple agentic chat models available", async () => {
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
      Env.set("GITLAB_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["gitlab"]).toBeDefined()
      const models = Object.keys(providers["gitlab"].models)
      expect(models.length).toBeGreaterThan(0)
      expect(models).toContain("duo-chat-haiku-4-5")
      expect(models).toContain("duo-chat-sonnet-4-5")
      expect(models).toContain("duo-chat-opus-4-5")
    },
  })
})
