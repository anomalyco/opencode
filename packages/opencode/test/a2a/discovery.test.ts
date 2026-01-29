import { describe, expect, test, beforeEach, spyOn, mock } from "bun:test"
import { getDiscoverableDomains, discoverAgents } from "../../src/a2a/discovery"
import { Config } from "../../src/config/config"
import * as AgentCard from "../../src/a2a/agent-card"

describe("a2a.discovery", () => {
  describe("getDiscoverableDomains", () => {
    test("returns domains from permission.remote_agent with allow action", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "allowed.com": "allow",
            "ask-domain.com": "ask",
            "denied.com": "deny",
          },
        },
      } as any)

      const domains = await getDiscoverableDomains()
      expect(domains).toContain("allowed.com")
      expect(domains).not.toContain("ask-domain.com")
      expect(domains).not.toContain("denied.com")
    })

    test("excludes wildcard patterns", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "*": "allow",
            "*.example.com": "allow",
            "specific.com": "allow",
          },
        },
      } as any)

      const domains = await getDiscoverableDomains()
      expect(domains).toContain("specific.com")
      expect(domains).not.toContain("*")
      expect(domains).not.toContain("*.example.com")
    })

    test("includes legacy remoteAgents.domains", async () => {
      spyOn(Config, "get").mockResolvedValue({
        remoteAgents: {
          domains: ["legacy1.com", "legacy2.com"],
        },
      } as any)

      const domains = await getDiscoverableDomains()
      expect(domains).toContain("legacy1.com")
      expect(domains).toContain("legacy2.com")
    })

    test("combines permission and legacy config", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "new.com": "allow",
          },
        },
        remoteAgents: {
          domains: ["legacy.com"],
        },
      } as any)

      const domains = await getDiscoverableDomains()
      expect(domains).toContain("new.com")
      expect(domains).toContain("legacy.com")
    })

    test("deduplicates domains", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "same.com": "allow",
          },
        },
        remoteAgents: {
          domains: ["same.com"],
        },
      } as any)

      const domains = await getDiscoverableDomains()
      expect(domains.filter((d) => d === "same.com")).toHaveLength(1)
    })

    test("returns empty array when no config", async () => {
      spyOn(Config, "get").mockResolvedValue({} as any)

      const domains = await getDiscoverableDomains()
      expect(domains).toEqual([])
    })

    test("handles string permission action", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: "allow",
        },
      } as any)

      const domains = await getDiscoverableDomains()
      expect(domains).toEqual([])
    })
  })

  describe("discoverAgents", () => {
    test("fetches agent cards for discoverable domains", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "agent.example.com": "allow",
          },
        },
      } as any)

      const mockCard = {
        name: "Test Agent",
        description: "A test agent",
        url: "https://agent.example.com/a2a",
        version: "1.0.0",
        protocolVersion: "1.0",
        capabilities: {},
        skills: [],
        defaultInputModes: ["text"],
        defaultOutputModes: ["text"],
      }

      spyOn(AgentCard, "fetchAgentCard").mockResolvedValue(mockCard as any)

      const agents = await discoverAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].domain).toBe("agent.example.com")
      expect(agents[0].card).toBe(mockCard)
    })

    test("handles fetch errors gracefully", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "working.com": "allow",
            "broken.com": "allow",
          },
        },
      } as any)

      const mockCard = {
        name: "Working Agent",
        description: "A working agent",
        url: "https://working.com/a2a",
        version: "1.0.0",
        protocolVersion: "1.0",
        capabilities: {},
        skills: [],
        defaultInputModes: ["text"],
        defaultOutputModes: ["text"],
      }

      spyOn(AgentCard, "fetchAgentCard").mockImplementation(async (ref: string) => {
        if (ref === "@broken.com") {
          throw new Error("Network error")
        }
        return mockCard as any
      })

      const agents = await discoverAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].domain).toBe("working.com")
    })

    test("returns empty array when no domains configured", async () => {
      spyOn(Config, "get").mockResolvedValue({} as any)

      const agents = await discoverAgents()
      expect(agents).toEqual([])
    })
  })
})
