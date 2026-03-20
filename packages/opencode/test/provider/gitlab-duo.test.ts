import { test, expect, describe } from "bun:test"
import path from "path"

import { ProviderID, ModelID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"
import { Global } from "../../src/global"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"

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
      expect(providers[ProviderID.gitlab]).toBeDefined()
      expect(providers[ProviderID.gitlab].key).toBe("test-gitlab-token")
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
      expect(providers[ProviderID.gitlab]).toBeDefined()
      expect(providers[ProviderID.gitlab].options?.instanceUrl).toBe("https://gitlab.example.com")
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
      expect(providers[ProviderID.gitlab]).toBeDefined()
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
      expect(providers[ProviderID.gitlab]).toBeDefined()
      expect(providers[ProviderID.gitlab].key).toBe("glpat-test-pat-token")
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
      expect(providers[ProviderID.gitlab]).toBeDefined()
      expect(providers[ProviderID.gitlab].options?.instanceUrl).toBe("https://gitlab.company.internal")
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
      expect(providers[ProviderID.gitlab]).toBeDefined()
    },
  })
})

test("GitLab Duo: includes context-1m beta header in aiGatewayHeaders", async () => {
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
      expect(providers[ProviderID.gitlab]).toBeDefined()
      expect(providers[ProviderID.gitlab].options?.aiGatewayHeaders?.["anthropic-beta"]).toContain(
        "context-1m-2025-08-07",
      )
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
      expect(providers[ProviderID.gitlab]).toBeDefined()
      expect(providers[ProviderID.gitlab].options?.featureFlags).toBeDefined()
      expect(providers[ProviderID.gitlab].options?.featureFlags?.duo_agent_platform_agentic_chat).toBe(true)
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
      expect(providers[ProviderID.gitlab]).toBeDefined()
      const models = Object.keys(providers[ProviderID.gitlab].models)
      expect(models.length).toBeGreaterThan(0)
      expect(models).toContain("duo-chat-haiku-4-5")
      expect(models).toContain("duo-chat-sonnet-4-5")
      expect(models).toContain("duo-chat-opus-4-5")
    },
  })
})

describe("GitLab Duo: workflow model routing", () => {
  test("duo-workflow-* model routes through workflowChat", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GITLAB_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const gitlab = providers[ProviderID.gitlab]
        expect(gitlab).toBeDefined()
        gitlab.models["duo-workflow-sonnet-4-6"] = {
          id: ModelID.make("duo-workflow-sonnet-4-6"),
          providerID: ProviderID.make("gitlab"),
          name: "Agent Platform (Claude Sonnet 4.6)",
          family: "",
          api: { id: "duo-workflow-sonnet-4-6", url: "https://gitlab.com", npm: "gitlab-ai-provider" },
          status: "active",
          headers: {},
          options: { workflowRef: "claude_sonnet_4_6" },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 200000, output: 64000 },
          capabilities: {
            temperature: false,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          release_date: "",
          variants: {},
        }
        const model = await Provider.getModel(ProviderID.gitlab, ModelID.make("duo-workflow-sonnet-4-6"))
        expect(model).toBeDefined()
        expect(model.options?.workflowRef).toBe("claude_sonnet_4_6")
        const language = await Provider.getLanguage(model)
        expect(language).toBeDefined()
        expect(language).toBeInstanceOf(GitLabWorkflowLanguageModel)
      },
    })
  })

  test("duo-chat-* model routes through agenticChat (not workflow)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GITLAB_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers[ProviderID.gitlab]).toBeDefined()
        const model = await Provider.getModel(ProviderID.gitlab, ModelID.make("duo-chat-sonnet-4-5"))
        expect(model).toBeDefined()
        const language = await Provider.getLanguage(model)
        expect(language).toBeDefined()
        expect(language).not.toBeInstanceOf(GitLabWorkflowLanguageModel)
      },
    })
  })

  test("model.options merged with provider.options in getLanguage", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GITLAB_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const gitlab = providers[ProviderID.gitlab]
        expect(gitlab.options?.featureFlags).toBeDefined()
        const model = await Provider.getModel(ProviderID.gitlab, ModelID.make("duo-chat-sonnet-4-5"))
        expect(model).toBeDefined()
        expect(model.options).toBeDefined()
      },
    })
  })
})

describe("GitLab Duo: static models", () => {
  test("static duo-chat models always present regardless of discovery", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GITLAB_TOKEN", "test-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const models = Object.keys(providers[ProviderID.gitlab].models)
        expect(models).toContain("duo-chat-haiku-4-5")
        expect(models).toContain("duo-chat-sonnet-4-5")
        expect(models).toContain("duo-chat-opus-4-5")
      },
    })
  })
})
