import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { A2AAuth } from "../../src/a2a/oauth/storage"
import { Instance } from "../../src/project/instance"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("a2a.oauth.storage", () => {
  const testDomain = "test-storage-domain.com"

  beforeEach(async () => {
    await A2AAuth.remove(testDomain)
  })

  afterEach(async () => {
    await A2AAuth.remove(testDomain)
  })

  describe("tokens", () => {
    test("stores and retrieves tokens", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        refreshToken: "refresh-456",
        expiresAt: Date.now() / 1000 + 3600,
      })

      const entry = await A2AAuth.get(testDomain)
      expect(entry?.tokens?.accessToken).toBe("access-123")
      expect(entry?.tokens?.refreshToken).toBe("refresh-456")
    })

    test("returns undefined for unknown domain", async () => {
      const entry = await A2AAuth.get("unknown-domain.com")
      expect(entry).toBeUndefined()
    })

    test("removes tokens", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
      })
      await A2AAuth.remove(testDomain)

      const entry = await A2AAuth.get(testDomain)
      expect(entry).toBeUndefined()
    })
  })

  describe("token expiry", () => {
    test("isTokenExpired returns null when no tokens", async () => {
      const expired = await A2AAuth.isTokenExpired(testDomain)
      expect(expired).toBeNull()
    })

    test("isTokenExpired returns false when no expiresAt", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
      })

      const expired = await A2AAuth.isTokenExpired(testDomain)
      expect(expired).toBe(false)
    })

    test("isTokenExpired returns false for future expiry", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        expiresAt: Date.now() / 1000 + 3600, // 1 hour from now
      })

      const expired = await A2AAuth.isTokenExpired(testDomain)
      expect(expired).toBe(false)
    })

    test("isTokenExpired returns true for past expiry", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        expiresAt: Date.now() / 1000 - 3600, // 1 hour ago
      })

      const expired = await A2AAuth.isTokenExpired(testDomain)
      expect(expired).toBe(true)
    })
  })

  describe("hasValidTokens", () => {
    test("returns false when no tokens", async () => {
      const valid = await A2AAuth.hasValidTokens(testDomain)
      expect(valid).toBe(false)
    })

    test("returns true when tokens exist and not expired", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        expiresAt: Date.now() / 1000 + 3600,
      })

      const valid = await A2AAuth.hasValidTokens(testDomain)
      expect(valid).toBe(true)
    })

    test("returns true when expired but refresh token exists", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        refreshToken: "refresh-456",
        expiresAt: Date.now() / 1000 - 3600, // expired
      })

      const valid = await A2AAuth.hasValidTokens(testDomain)
      expect(valid).toBe(true)
    })

    test("returns false when expired and no refresh token", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        expiresAt: Date.now() / 1000 - 3600, // expired
      })

      const valid = await A2AAuth.hasValidTokens(testDomain)
      expect(valid).toBe(false)
    })
  })

  describe("code verifier", () => {
    test("stores and retrieves code verifier", async () => {
      await A2AAuth.updateCodeVerifier(testDomain, "verifier-123")

      const verifier = await A2AAuth.getCodeVerifier(testDomain)
      expect(verifier).toBe("verifier-123")
    })

    test("clears code verifier", async () => {
      await A2AAuth.updateCodeVerifier(testDomain, "verifier-123")
      await A2AAuth.clearCodeVerifier(testDomain)

      const verifier = await A2AAuth.getCodeVerifier(testDomain)
      expect(verifier).toBeUndefined()
    })
  })

  describe("oauth state", () => {
    test("stores and retrieves oauth state", async () => {
      await A2AAuth.updateOAuthState(testDomain, "state-123")

      const state = await A2AAuth.getOAuthState(testDomain)
      expect(state).toBe("state-123")
    })

    test("clears oauth state", async () => {
      await A2AAuth.updateOAuthState(testDomain, "state-123")
      await A2AAuth.clearOAuthState(testDomain)

      const state = await A2AAuth.getOAuthState(testDomain)
      expect(state).toBeUndefined()
    })
  })

  describe("layered loading", () => {
    const projectDomain = "project-domain.com"
    const userDomain = "user-domain.com"
    const sharedDomain = "shared-domain.com"

    test("project auth takes precedence over user auth for same domain", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "a2a-test-"))
      const projectAuthDir = path.join(tmpDir, ".opencode")
      const projectAuthFile = path.join(projectAuthDir, "a2a-auth.json")

      try {
        await fs.mkdir(projectAuthDir, { recursive: true })

        // First store user-level auth
        await A2AAuth.updateTokens(sharedDomain, {
          accessToken: "user-access-token",
          refreshToken: "user-refresh-token",
        })

        // Create project-level auth with different token
        const projectAuth = {
          [sharedDomain]: {
            domain: sharedDomain,
            tokens: {
              accessToken: "project-access-token",
              refreshToken: "project-refresh-token",
            },
          },
        }
        await fs.writeFile(projectAuthFile, JSON.stringify(projectAuth))

        // Run within Instance context to enable project-level loading
        await Instance.provide({
          directory: tmpDir,
          fn: async () => {
            const entry = await A2AAuth.get(sharedDomain)
            // Project auth should take precedence
            expect(entry?.tokens?.accessToken).toBe("project-access-token")
            expect(entry?.tokens?.refreshToken).toBe("project-refresh-token")
          },
        })
      } finally {
        // Cleanup
        await A2AAuth.remove(sharedDomain)
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    test("merges entries from both user and project levels", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "a2a-test-"))
      const projectAuthDir = path.join(tmpDir, ".opencode")
      const projectAuthFile = path.join(projectAuthDir, "a2a-auth.json")

      try {
        await fs.mkdir(projectAuthDir, { recursive: true })

        // Store user-level auth for one domain
        await A2AAuth.updateTokens(userDomain, {
          accessToken: "user-only-token",
        })

        // Create project-level auth for a different domain
        const projectAuth = {
          [projectDomain]: {
            domain: projectDomain,
            tokens: {
              accessToken: "project-only-token",
            },
          },
        }
        await fs.writeFile(projectAuthFile, JSON.stringify(projectAuth))

        await Instance.provide({
          directory: tmpDir,
          fn: async () => {
            const allEntries = await A2AAuth.all()

            // Both domains should be present
            expect(allEntries[userDomain]?.tokens?.accessToken).toBe("user-only-token")
            expect(allEntries[projectDomain]?.tokens?.accessToken).toBe("project-only-token")
          },
        })
      } finally {
        await A2AAuth.remove(userDomain)
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    test("writes always go to user level", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "a2a-test-"))
      const projectAuthDir = path.join(tmpDir, ".opencode")
      const projectAuthFile = path.join(projectAuthDir, "a2a-auth.json")
      const writeTestDomain = "write-test-domain.com"

      try {
        await fs.mkdir(projectAuthDir, { recursive: true })
        await fs.writeFile(projectAuthFile, JSON.stringify({}))

        await Instance.provide({
          directory: tmpDir,
          fn: async () => {
            // Write new tokens
            await A2AAuth.updateTokens(writeTestDomain, {
              accessToken: "new-token",
            })

            // Verify project file wasn't modified
            const projectContent = JSON.parse(await fs.readFile(projectAuthFile, "utf-8"))
            expect(projectContent[writeTestDomain]).toBeUndefined()
          },
        })

        // Verify user-level file has the token (outside Instance context)
        const entry = await A2AAuth.get(writeTestDomain)
        expect(entry?.tokens?.accessToken).toBe("new-token")
      } finally {
        await A2AAuth.remove(writeTestDomain)
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })
  })
})
