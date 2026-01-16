import { test, expect, describe } from "bun:test"
import { GiteaAdapter } from "../../src/git-platform/gitea/adapter"
import { ForgejoAdapter } from "../../src/git-platform/forgejo/adapter"

describe("GiteaAdapter", () => {
  test("sets platform to gitea", () => {
    const adapter = new GiteaAdapter({
      baseUrl: "https://gitea.example.com",
      token: "test-token",
    })
    expect(adapter.platform).toBe("gitea")
  })

  test("uses default bot username", () => {
    const adapter = new GiteaAdapter({
      baseUrl: "https://gitea.example.com",
      token: "test-token",
    })
    expect(adapter.botUsername).toBe("opencode-bot")
  })

  test("uses custom bot username", () => {
    const adapter = new GiteaAdapter({
      baseUrl: "https://gitea.example.com",
      token: "test-token",
      botUsername: "my-bot",
    })
    expect(adapter.botUsername).toBe("my-bot")
  })

  test("generates correct remote URL", () => {
    const adapter = new GiteaAdapter({
      baseUrl: "https://gitea.example.com",
      token: "test-token",
    })
    expect(adapter.getRemoteUrl("owner", "repo")).toBe("https://gitea.example.com/owner/repo.git")
  })

  test("generates correct agent name", () => {
    const adapter = new GiteaAdapter({
      baseUrl: "https://gitea.example.com",
      token: "test-token",
      botUsername: "my-bot",
    })
    expect(adapter.getAgentName()).toBe("my-bot")
  })

  test("generates correct agent email", () => {
    const adapter = new GiteaAdapter({
      baseUrl: "https://gitea.example.com",
      token: "test-token",
      botUsername: "my-bot",
    })
    expect(adapter.getAgentEmail()).toBe("my-bot@gitea.example.com")
  })
})

describe("ForgejoAdapter", () => {
  test("sets platform to forgejo", () => {
    const adapter = new ForgejoAdapter({
      baseUrl: "https://codeberg.org",
      token: "test-token",
    })
    expect(adapter.platform).toBe("forgejo")
  })

  test("inherits from GiteaAdapter", () => {
    const adapter = new ForgejoAdapter({
      baseUrl: "https://forgejo.example.com",
      token: "test-token",
    })
    expect(adapter.getRemoteUrl("owner", "repo")).toBe("https://forgejo.example.com/owner/repo.git")
  })

  test("uses default bot username", () => {
    const adapter = new ForgejoAdapter({
      baseUrl: "https://codeberg.org",
      token: "test-token",
    })
    expect(adapter.botUsername).toBe("opencode-bot")
  })
})
