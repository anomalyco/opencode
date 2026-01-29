import { describe, expect, test, beforeEach, spyOn, mock } from "bun:test"
import { getDiscoverableAgentRefs, discoverAgents } from "../../src/a2a/discovery"
import { Config } from "../../src/config/config"
import * as AgentCard from "../../src/a2a/agent-card"

describe("a2a.discovery", () => {
  describe("getDiscoverableAgentRefs", () => {
    test("returns refs from permission.remote_agent with allow action", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "allowed.com": "allow",
            "ask-domain.com": "ask",
            "denied.com": "deny",
          },
        },
      } as any)

      const refs = await getDiscoverableAgentRefs()
      expect(refs).toContain("allowed.com")
      expect(refs).not.toContain("ask-domain.com")
      expect(refs).not.toContain("denied.com")
    })

    test("supports path-based agent refs", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "vercel.com": "allow",
            "vercel.com/deploy-agent": "allow",
            "vercel.com/review-agent": "allow",
          },
        },
      } as any)

      const refs = await getDiscoverableAgentRefs()
      expect(refs).toContain("vercel.com")
      expect(refs).toContain("vercel.com/deploy-agent")
      expect(refs).toContain("vercel.com/review-agent")
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

      const refs = await getDiscoverableAgentRefs()
      expect(refs).toContain("specific.com")
      expect(refs).not.toContain("*")
      expect(refs).not.toContain("*.example.com")
    })

    test("includes legacy remoteAgents.domains", async () => {
      spyOn(Config, "get").mockResolvedValue({
        remoteAgents: {
          domains: ["legacy1.com", "legacy2.com"],
        },
      } as any)

      const refs = await getDiscoverableAgentRefs()
      expect(refs).toContain("legacy1.com")
      expect(refs).toContain("legacy2.com")
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

      const refs = await getDiscoverableAgentRefs()
      expect(refs).toContain("new.com")
      expect(refs).toContain("legacy.com")
    })

    test("deduplicates refs", async () => {
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

      const refs = await getDiscoverableAgentRefs()
      expect(refs.filter((d) => d === "same.com")).toHaveLength(1)
    })

    test("returns empty array when no config", async () => {
      spyOn(Config, "get").mockResolvedValue({} as any)

      const refs = await getDiscoverableAgentRefs()
      expect(refs).toEqual([])
    })

    test("handles string permission action", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: "allow",
        },
      } as any)

      const refs = await getDiscoverableAgentRefs()
      expect(refs).toEqual([])
    })
  })

  describe("discoverAgents", () => {
    test("fetches agent cards for discoverable refs", async () => {
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
      spyOn(AgentCard, "requiresOAuth").mockReturnValue(false)

      const agents = await discoverAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].ref).toBe("agent.example.com")
      expect(agents[0].card).toBe(mockCard)
      expect(agents[0].requiresAuth).toBe(false)
    })

    test("detects OAuth requirement", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "oauth-agent.com": "allow",
          },
        },
      } as any)

      const mockCard = {
        name: "OAuth Agent",
        description: "An agent requiring OAuth",
        url: "https://oauth-agent.com/a2a",
        version: "1.0.0",
        protocolVersion: "1.0",
        capabilities: {},
        skills: [],
        defaultInputModes: ["text"],
        defaultOutputModes: ["text"],
        securitySchemes: { oauth2: { type: "oauth2" } },
        security: [{ oauth2: [] }],
      }

      spyOn(AgentCard, "fetchAgentCard").mockResolvedValue(mockCard as any)
      spyOn(AgentCard, "requiresOAuth").mockReturnValue(true)

      const agents = await discoverAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].requiresAuth).toBe(true)
    })

    test("discovers path-based agents", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "vercel.com/deploy": "allow",
          },
        },
      } as any)

      const mockCard = {
        name: "Deploy Agent",
        description: "Vercel deploy agent",
        url: "https://vercel.com/deploy/a2a",
        version: "1.0.0",
        protocolVersion: "1.0",
        capabilities: {},
        skills: [],
        defaultInputModes: ["text"],
        defaultOutputModes: ["text"],
      }

      spyOn(AgentCard, "fetchAgentCard").mockResolvedValue(mockCard as any)
      spyOn(AgentCard, "requiresOAuth").mockReturnValue(false)

      const agents = await discoverAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].ref).toBe("vercel.com/deploy")
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
      spyOn(AgentCard, "requiresOAuth").mockReturnValue(false)

      const agents = await discoverAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].ref).toBe("working.com")
    })

    test("returns empty array when no refs configured", async () => {
      spyOn(Config, "get").mockResolvedValue({} as any)

      const agents = await discoverAgents()
      expect(agents).toEqual([])
    })
  })
})
