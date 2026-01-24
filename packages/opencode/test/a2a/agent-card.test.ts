import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from "bun:test"
import {
  parseAgentRef,
  resolveAgentCardUrl,
  fetchAgentCard,
  buildEndpointUrl,
  getDomainFromAgentUrl,
  clearCache,
} from "../../src/a2a/agent-card"

const originalFetch = globalThis.fetch

describe("a2a.agent-card", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })
  describe("parseAgentRef", () => {
    test("returns null for non-@ references", () => {
      expect(parseAgentRef("domain.com")).toBeNull()
      expect(parseAgentRef("http://domain.com")).toBeNull()
      expect(parseAgentRef("")).toBeNull()
    })

    test("parses @domain.com as { domain, path: null }", () => {
      const result = parseAgentRef("@domain.com")
      expect(result).toEqual({ domain: "domain.com", path: null })
    })

    test("parses @domain.com/path as { domain, path }", () => {
      const result = parseAgentRef("@domain.com/foo")
      expect(result).toEqual({ domain: "domain.com", path: "/foo" })
    })

    test("parses @domain.com/nested/path as { domain, path }", () => {
      const result = parseAgentRef("@domain.com/foo/bar")
      expect(result).toEqual({ domain: "domain.com", path: "/foo/bar" })
    })

    test("parses @localhost:3000 with port", () => {
      const result = parseAgentRef("@localhost:3000")
      expect(result).toEqual({ domain: "localhost:3000", path: null })
    })

    test("parses @localhost:3000/path with port and path", () => {
      const result = parseAgentRef("@localhost:3000/api/agent")
      expect(result).toEqual({ domain: "localhost:3000", path: "/api/agent" })
    })

    test("parses @domain.com:8080 with port", () => {
      const result = parseAgentRef("@example.com:8080")
      expect(result).toEqual({ domain: "example.com:8080", path: null })
    })

    test("parses subdomain with multiple parts", () => {
      const result = parseAgentRef("@api.example.com")
      expect(result).toEqual({ domain: "api.example.com", path: null })
    })

    test("returns null for invalid patterns", () => {
      expect(parseAgentRef("@")).toBeNull()
      expect(parseAgentRef("@ ")).toBeNull()
      expect(parseAgentRef("@-invalid")).toBeNull()
    })
  })

  describe("resolveAgentCardUrl", () => {
    test("root: @domain.com → https://domain.com/.well-known/a2a/agent-card", () => {
      const url = resolveAgentCardUrl("@domain.com")
      expect(url).toBe("https://domain.com/.well-known/a2a/agent-card")
    })

    test("path: @domain.com/foo → https://domain.com/foo/agent-card.json", () => {
      const url = resolveAgentCardUrl("@domain.com/foo")
      expect(url).toBe("https://domain.com/foo/agent-card.json")
    })

    test("nested path: @domain.com/foo/bar → https://domain.com/foo/bar/agent-card.json", () => {
      const url = resolveAgentCardUrl("@domain.com/foo/bar")
      expect(url).toBe("https://domain.com/foo/bar/agent-card.json")
    })

    test("localhost uses http protocol", () => {
      const url = resolveAgentCardUrl("@localhost:3000")
      expect(url).toBe("http://localhost:3000/.well-known/a2a/agent-card")
    })

    test("localhost with path uses http protocol", () => {
      const url = resolveAgentCardUrl("@localhost:3000/agent")
      expect(url).toBe("http://localhost:3000/agent/agent-card.json")
    })

    test("throws on invalid reference", () => {
      expect(() => resolveAgentCardUrl("invalid")).toThrow("Invalid agent reference")
    })
  })

  describe("buildEndpointUrl", () => {
    test("returns absolute URL unchanged", () => {
      expect(buildEndpointUrl("https://example.com/api", "https://other.com/endpoint")).toBe(
        "https://other.com/endpoint",
      )
      expect(buildEndpointUrl("https://example.com/api", "http://other.com/endpoint")).toBe("http://other.com/endpoint")
    })

    test("combines base origin with relative endpoint", () => {
      expect(buildEndpointUrl("https://example.com/api", "/message/send")).toBe("https://example.com/message/send")
    })

    test("preserves port in base URL", () => {
      expect(buildEndpointUrl("http://localhost:3000/api", "/tasks/get")).toBe("http://localhost:3000/tasks/get")
    })
  })

  describe("getDomainFromAgentUrl", () => {
    test("extracts host from URL", () => {
      expect(getDomainFromAgentUrl("https://example.com/api")).toBe("example.com")
      expect(getDomainFromAgentUrl("http://localhost:3000/api")).toBe("localhost:3000")
      expect(getDomainFromAgentUrl("https://api.example.com:8080/")).toBe("api.example.com:8080")
    })
  })

  describe("fetchAgentCard", () => {
    const mockAgentCard = {
      name: "Test Agent",
      description: "A test agent",
      url: "https://example.com/api",
      version: "1.0.0",
      protocolVersion: "0.1",
      capabilities: {
        streaming: true,
        pushNotifications: false,
      },
      skills: [
        {
          id: "test-skill",
          name: "Test Skill",
          description: "A test skill",
          tags: ["test"],
        },
      ],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
    }

    beforeEach(() => {
      clearCache()
    })

    test("fetches and returns AgentCard", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockAgentCard,
      } as Response)

      const card = await fetchAgentCard("@example.com")

      expect(card.name).toBe("Test Agent")
      expect(card.url).toBe("https://example.com/api")
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/.well-known/a2a/agent-card", expect.any(Object))
    })

    test("caches for 5 minutes", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => mockAgentCard,
      } as Response)

      await fetchAgentCard("@example.com")
      await fetchAgentCard("@example.com")

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    test("throws on HTTP error", async () => {
      spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response)

      await expect(fetchAgentCard("@example.com")).rejects.toThrow("Failed to fetch agent card")
    })

    test("throws on invalid response", async () => {
      spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: "data" }),
      } as Response)

      await expect(fetchAgentCard("@example.com")).rejects.toThrow("Invalid agent card")
    })
  })
})
