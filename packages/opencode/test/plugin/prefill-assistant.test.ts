import { test, expect, describe } from "bun:test"

// Mock plugin implementation for testing
async function createMockPrefillPlugin(config = {}) {
  let userConfig: any = config

  const getPrefill = (params: {
    config: any
    agent: string
    userMessage: string
    conversationDepth: number
    providerID: string
  }): string | undefined => {
    const { config, agent, userMessage, conversationDepth, providerID } = params

    if (!config.enabled) return undefined
    if (providerID !== "anthropic") return undefined

    // Pattern detection
    if (config.patternDetection) {
      if (/\b(json|object|structured\s+data)\b/i.test(userMessage)) {
        return config.contexts.jsonOutput
      }
      if (/\b(code\s+only|just\s+(the\s+)?code|show\s+code)\b/i.test(userMessage)) {
        return config.contexts.codeOnly
      }
      if (/\b(concise|brief|quick|short|summarize)\b/i.test(userMessage)) {
        return config.contexts.concise
      }
    }

    // Agent-based prefilling
    if (config.agentPrefilling && agent) {
      const agentKey = agent.toLowerCase()
      if (config.contexts[agentKey]) {
        return config.contexts[agentKey]
      }
    }

    // Role maintenance
    if (conversationDepth >= config.minDepthForRole && agent) {
      const roleKey = agent.toLowerCase()
      if (config.contexts[roleKey]) {
        return config.contexts[roleKey]
      }
      return `[${agent.charAt(0).toUpperCase() + agent.slice(1)}]`
    }

    return undefined
  }

  const defaultConfig = {
    enabled: true,
    contexts: {
      jsonOutput: "{",
      codeOnly: "```",
      orchestrator: "[Orchestrator]",
      general: "[General Agent]",
      plan: "[Planning Mode - Read Only]",
      concise: "Here's the solution:",
      technical: "Technical analysis:",
      debugging: "[Debug Context]",
    },
    agentPrefilling: true,
    patternDetection: true,
    minDepthForRole: 10,
  }

  return {
    config: async (projectConfig: any) => {
      if (projectConfig.prefillAssistant) {
        userConfig = {
          ...defaultConfig,
          ...projectConfig.prefillAssistant,
          contexts: {
            ...defaultConfig.contexts,
            ...projectConfig.prefillAssistant.contexts,
          },
        }
      } else {
        userConfig = defaultConfig
      }
    },
    "chat.messages": async (input: any, output: any) => {
      const cfg = userConfig.enabled !== undefined ? userConfig : defaultConfig
      const prefill = getPrefill({
        config: cfg,
        agent: input.agent,
        userMessage: input.userText || "",
        conversationDepth: input.conversationDepth,
        providerID: input.provider.id,
      })

      if (prefill) {
        output.messages.push({
          role: "assistant",
          content: prefill,
        })
      }
    },
  }
}

describe("Prefill Assistant Plugin", () => {
  describe("Pattern Detection", () => {
    test("detects JSON output request", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "existing message" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Extract this data as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toMatchObject({
        role: "assistant",
        content: "{",
      })
    })

    test("detects code-only request", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "show me the code only",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toMatchObject({
        role: "assistant",
        content: "```",
      })
    })

    test("detects concise request", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "be brief and concise",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1].content).toContain("solution")
    })
  })

  describe("Agent Prefilling", () => {
    test("applies orchestrator prefill", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "What should we do next?",
          agent: "orchestrator",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toMatchObject({
        role: "assistant",
        content: "[Orchestrator]",
      })
    })

    test("applies plan agent prefill", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Analyze the architecture",
          agent: "plan",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toMatchObject({
        role: "assistant",
        content: "[Planning Mode - Read Only]",
      })
    })
  })

  describe("Provider Detection", () => {
    test("does not apply prefill for non-anthropic providers", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "openai", name: "openai" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Extract as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(1)
    })

    test("applies prefill for anthropic provider", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Extract as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
    })
  })

  describe("Conversation Depth", () => {
    test("applies role prefill after minimum depth", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Continue analysis",
          agent: "general",
          conversationDepth: 15,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toMatchObject({
        role: "assistant",
        content: "[General Agent]",
      })
    })

    test("does not apply fallback role prefill before minimum depth", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      // Use an agent that doesn't have a predefined context
      // so it would fall back to the generic role marker only if depth is sufficient
      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Continue analysis",
          agent: "custom_agent", // No predefined context for this agent
          conversationDepth: 3, // Below minDepthForRole (10)
        },
        output,
      )

      // Should not add prefill because depth is below threshold and no pattern match
      expect(output.messages).toHaveLength(1)
    })
  })

  describe("Configuration", () => {
    test("respects disabled configuration", async () => {
      const plugin = await createMockPrefillPlugin()

      await plugin.config({
        prefillAssistant: {
          enabled: false,
        },
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Extract as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(1)
    })

    test("respects custom contexts", async () => {
      const plugin = await createMockPrefillPlugin()

      await plugin.config({
        prefillAssistant: {
          contexts: {
            jsonOutput: "{ // Custom JSON prefill",
          },
        },
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Extract as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toMatchObject({
        role: "assistant",
        content: "{ // Custom JSON prefill",
      })
    })

    test("respects disabled pattern detection", async () => {
      const plugin = await createMockPrefillPlugin()

      await plugin.config({
        prefillAssistant: {
          patternDetection: false,
        },
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Extract as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toMatchObject({
        role: "assistant",
        content: "[General Agent]",
      })
    })
  })

  describe("Priority", () => {
    test("pattern detection takes priority over agent prefilling", async () => {
      const plugin = await createMockPrefillPlugin()

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"](
        {
          model: { id: "test", name: "test" },
          provider: { id: "anthropic", name: "anthropic" },
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } },
          userText: "Extract as JSON for orchestrator",
          agent: "orchestrator",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toMatchObject({
        role: "assistant",
        content: "{",
      })
    })
  })
})
