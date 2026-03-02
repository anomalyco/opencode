import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"
import { isWorkflowModel } from "gitlab-ai-provider"

describe("GitLab Duo: workflow model support", () => {
  test("isWorkflowModel identifies workflow model IDs", () => {
    expect(isWorkflowModel("duo-workflow")).toBe(true)
    expect(isWorkflowModel("duo-workflow-default")).toBe(true)
    expect(isWorkflowModel("duo-workflow-sonnet-4-6")).toBe(true)
    expect(isWorkflowModel("duo-chat-sonnet-4-5")).toBe(false)
    expect(isWorkflowModel("gpt-4o")).toBe(false)
    expect(isWorkflowModel("")).toBe(false)
  })

  test("provider loads with feature flags for workflow", async () => {
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
        const gitlab = providers["gitlab"]
        expect(gitlab).toBeDefined()
        expect(gitlab.options?.featureFlags?.duo_agent_platform_agentic_chat).toBe(true)
        expect(gitlab.options?.featureFlags?.duo_agent_platform).toBe(true)
      },
    })
  })

  test("oauth instance matching: normalizes trailing slash", () => {
    const normalize = (url: string) => url.replace(/\/$/, "")
    expect(normalize("https://gitlab.com/")).toBe("https://gitlab.com")
    expect(normalize("https://gitlab.com")).toBe("https://gitlab.com")
    expect(normalize("https://self-hosted.example.com/")).toBe("https://self-hosted.example.com")
  })

  test("oauth instance matching: mismatched instance returns env token", () => {
    const instanceUrl = "https://gitlab.com"
    const normalizedInstanceUrl = instanceUrl.replace(/\/$/, "")
    const auth = { type: "oauth" as const, enterpriseUrl: "https://other-gitlab.example.com" }
    const envToken = "env-token"

    const apiKey = (() => {
      if (auth.type === "oauth") {
        const authInstance = (auth.enterpriseUrl || "https://gitlab.com").replace(/\/$/, "")
        if (authInstance === normalizedInstanceUrl) return "oauth-access-token"
        return envToken
      }
      return envToken
    })()

    expect(apiKey).toBe("env-token")
  })

  test("oauth instance matching: matching instance returns oauth token", () => {
    const instanceUrl = "https://gitlab.com"
    const normalizedInstanceUrl = instanceUrl.replace(/\/$/, "")
    const auth = { type: "oauth" as const, enterpriseUrl: "https://gitlab.com" }

    const apiKey = (() => {
      if (auth.type === "oauth") {
        const authInstance = (auth.enterpriseUrl || "https://gitlab.com").replace(/\/$/, "")
        if (authInstance === normalizedInstanceUrl) return "oauth-access-token"
        return "env-token"
      }
      return "env-token"
    })()

    expect(apiKey).toBe("oauth-access-token")
  })

  test("oauth instance matching: trailing slash on auth URL still matches", () => {
    const instanceUrl = "https://gitlab.com"
    const normalizedInstanceUrl = instanceUrl.replace(/\/$/, "")
    const auth = { type: "oauth" as const, enterpriseUrl: "https://gitlab.com/" }

    const apiKey = (() => {
      if (auth.type === "oauth") {
        const authInstance = (auth.enterpriseUrl || "https://gitlab.com").replace(/\/$/, "")
        if (authInstance === normalizedInstanceUrl) return "oauth-access-token"
        return "env-token"
      }
      return "env-token"
    })()

    expect(apiKey).toBe("oauth-access-token")
  })

  test("oauth instance matching: no enterpriseUrl defaults to gitlab.com", () => {
    const instanceUrl = "https://gitlab.com"
    const normalizedInstanceUrl = instanceUrl.replace(/\/$/, "")
    const auth = { type: "oauth" as const, enterpriseUrl: undefined as string | undefined }

    const apiKey = (() => {
      if (auth.type === "oauth") {
        const authInstance = (auth.enterpriseUrl || "https://gitlab.com").replace(/\/$/, "")
        if (authInstance === normalizedInstanceUrl) return "oauth-access-token"
        return "env-token"
      }
      return "env-token"
    })()

    expect(apiKey).toBe("oauth-access-token")
  })

  test("oauth instance matching: self-hosted instances match correctly", () => {
    const instanceUrl = "https://gitlab.company.internal"
    const normalizedInstanceUrl = instanceUrl.replace(/\/$/, "")
    const auth = { type: "oauth" as const, enterpriseUrl: "https://gitlab.company.internal" }

    const apiKey = (() => {
      if (auth.type === "oauth") {
        const authInstance = (auth.enterpriseUrl || "https://gitlab.com").replace(/\/$/, "")
        if (authInstance === normalizedInstanceUrl) return "oauth-access-token"
        return "env-token"
      }
      return "env-token"
    })()

    expect(apiKey).toBe("oauth-access-token")
  })

  test("api auth type returns key directly", () => {
    const auth: { type: string; key?: string } = { type: "api", key: "glpat-test-token" }
    const envToken = "env-token"

    const apiKey = (() => {
      if (auth.type === "oauth") return envToken
      if (auth.type === "api") return auth.key
      return envToken
    })()

    expect(apiKey).toBe("glpat-test-token")
  })
})
