import { describe, test, expect, beforeEach } from "bun:test"
import { VCSManager } from "../../src/vcs/manager"

describe("VCSManager", () => {
  test("initializes with GitLab provider by default", async () => {
    const manager = new VCSManager()
    await manager.initialize()

    expect(manager.providerName).toBe("gitlab")
  })

  test("initializes with GitHub provider when configured", async () => {
    const manager = new VCSManager({
      provider: "github",
      github: {
        token: "test-token",
        owner: "test-owner",
        repo: "test-repo",
      },
    })
    await manager.initialize()

    expect(manager.providerName).toBe("github")
  })

  test("throws error for unknown provider", async () => {
    const manager = new VCSManager({
      provider: "unknown" as any,
    })

    await expect(manager.initialize()).rejects.toThrow("Unknown VCS provider: unknown")
  })

  test("throws error when using methods before initialization", async () => {
    const manager = new VCSManager()

    await expect(manager.getAuthToken()).rejects.toThrow("VCSManager not initialized")
  })
})
