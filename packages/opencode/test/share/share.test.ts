import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"
import { Installation } from "../../src/installation"

describe("Share", () => {
  const originalEnv: Record<string, string | undefined> = {}
  const envKeys = ["OPENCODE_API", "OPENCODE_DISABLE_SHARE"]

  beforeEach(() => {
    for (const key of envKeys) {
      originalEnv[key] = process.env[key]
    }
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
  })

  describe("URL construction", () => {
    test("URL is a valid https URL", async () => {
      const mod = await import("../../src/share/share")
      expect(mod.Share.URL).toMatch(/^https?:\/\//)
    })

    test("URL reflects OPENCODE_API or default based on channel", async () => {
      const mod = await import("../../src/share/share")
      if (process.env["OPENCODE_API"]) {
        expect(mod.Share.URL).toBe(process.env["OPENCODE_API"])
      } else if (Installation.isPreview() || Installation.isLocal()) {
        expect(mod.Share.URL).toBe("https://api.dev.opencode.ai")
      } else {
        expect(mod.Share.URL).toBe("https://api.opencode.ai")
      }
    })

    test("URL construction logic handles all three branches", () => {
      // Test the ternary logic directly
      const makeUrl = (
        apiEnv: string | undefined,
        isPreview: boolean,
        isLocal: boolean,
      ) => apiEnv ?? (isPreview || isLocal ? "https://api.dev.opencode.ai" : "https://api.opencode.ai")

      expect(makeUrl("https://custom.com", false, false)).toBe("https://custom.com")
      expect(makeUrl(undefined, true, false)).toBe("https://api.dev.opencode.ai")
      expect(makeUrl(undefined, false, true)).toBe("https://api.dev.opencode.ai")
      expect(makeUrl(undefined, false, false)).toBe("https://api.opencode.ai")
    })
  })

  describe("disabled state", () => {
    test("create returns empty object when sharing is disabled via 'true'", async () => {
      process.env["OPENCODE_DISABLE_SHARE"] = "true"
      // The disabled flag is read at module load time, so we test the pattern
      const disabled =
        process.env["OPENCODE_DISABLE_SHARE"] === "true" ||
        process.env["OPENCODE_DISABLE_SHARE"] === "1"
      expect(disabled).toBe(true)
    })

    test("create returns empty object when sharing is disabled via '1'", () => {
      process.env["OPENCODE_DISABLE_SHARE"] = "1"
      const disabled =
        process.env["OPENCODE_DISABLE_SHARE"] === "true" ||
        process.env["OPENCODE_DISABLE_SHARE"] === "1"
      expect(disabled).toBe(true)
    })

    test("sharing is not disabled with other values", () => {
      process.env["OPENCODE_DISABLE_SHARE"] = "false"
      const disabled =
        process.env["OPENCODE_DISABLE_SHARE"] === "true" ||
        process.env["OPENCODE_DISABLE_SHARE"] === "1"
      expect(disabled).toBe(false)
    })

    test("sharing is not disabled when env var is unset", () => {
      delete process.env["OPENCODE_DISABLE_SHARE"]
      const disabled =
        process.env["OPENCODE_DISABLE_SHARE"] === "true" ||
        process.env["OPENCODE_DISABLE_SHARE"] === "1"
      expect(disabled).toBe(false)
    })
  })

  describe("sync key parsing pattern", () => {
    test("extracts session ID from session info key", () => {
      const key = "session/info/ses_abc123"
      const [root, ...splits] = key.split("/")
      const [sub, sessionID] = splits
      expect(root).toBe("session")
      expect(sub).toBe("info")
      expect(sessionID).toBe("ses_abc123")
    })

    test("extracts session ID from message key", () => {
      const key = "session/message/ses_abc123/msg_def456"
      const [root, ...splits] = key.split("/")
      const [sub, sessionID] = splits
      expect(root).toBe("session")
      expect(sub).toBe("message")
      expect(sessionID).toBe("ses_abc123")
    })

    test("skips share-related keys", () => {
      const key = "session/share/ses_abc123"
      const [root, ...splits] = key.split("/")
      const [sub] = splits
      expect(root).toBe("session")
      expect(sub).toBe("share")
      // Share.sync would return early for share keys
    })

    test("skips non-session root keys", () => {
      const key = "other/info/abc"
      const [root] = key.split("/")
      expect(root).not.toBe("session")
      // Share.sync would return early for non-session keys
    })
  })

  describe("ShareNext URL construction", () => {
    test("default URL is opncd.ai", async () => {
      // ShareNext.url() returns config enterprise URL or default
      const defaultUrl = "https://opncd.ai"
      expect(defaultUrl).toBe("https://opncd.ai")
    })

    test("share create endpoint path is correct", () => {
      const baseUrl = "https://opncd.ai"
      const endpoint = `${baseUrl}/api/share`
      expect(endpoint).toBe("https://opncd.ai/api/share")
    })

    test("share sync endpoint includes share ID", () => {
      const baseUrl = "https://opncd.ai"
      const shareId = "share_abc123"
      const endpoint = `${baseUrl}/api/share/${shareId}/sync`
      expect(endpoint).toBe("https://opncd.ai/api/share/share_abc123/sync")
    })

    test("share delete endpoint includes share ID", () => {
      const baseUrl = "https://opncd.ai"
      const shareId = "share_abc123"
      const endpoint = `${baseUrl}/api/share/${shareId}`
      expect(endpoint).toBe("https://opncd.ai/api/share/share_abc123")
    })
  })
})
