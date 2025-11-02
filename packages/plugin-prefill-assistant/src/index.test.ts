import { test, expect, describe } from "bun:test"
import { PrefillAssistantPlugin } from "./index"

describe("PrefillAssistantPlugin", () => {
  describe("Pattern Detection", () => {
    test("detects JSON output request", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [
          { role: "user" as const, content: "existing message" },
        ],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "Extract this data as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toEqual({
        role: "assistant",
        content: "{",
      })
    })

    test("detects code-only request", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "show me the code only",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toEqual({
        role: "assistant",
        content: "```",
      })
    })

    test("detects concise request", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
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
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "What should we do next?",
          agent: "orchestrator",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toEqual({
        role: "assistant",
        content: "[Orchestrator]",
      })
    })

    test("applies plan agent prefill", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "Analyze the architecture",
          agent: "plan",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toEqual({
        role: "assistant",
        content: "[Planning Mode - Read Only]",
      })
    })
  })

  describe("Provider Detection", () => {
    test("does not apply prefill for non-anthropic providers", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "openai", name: "openai" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "Extract as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      // Should not add prefill for non-Anthropic provider
      expect(output.messages).toHaveLength(1)
    })

    test("applies prefill for anthropic provider", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
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
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "Continue analysis",
          agent: "general",
          conversationDepth: 15, // Above default minDepthForRole (10)
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toEqual({
        role: "assistant",
        content: "[General Agent]",
      })
    })

    test("does not apply role prefill before minimum depth", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "Continue analysis",
          agent: "general",
          conversationDepth: 3, // Below default minDepthForRole (10)
        },
        output,
      )

      // No pattern match, no agent-based prefill, below depth threshold
      expect(output.messages).toHaveLength(1)
    })
  })

  describe("Configuration", () => {
    test("respects disabled configuration", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      // Simulate config hook
      await plugin.config?.({
        prefillAssistant: {
          enabled: false,
        },
      } as any)

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "Extract as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      // Should not add prefill when disabled
      expect(output.messages).toHaveLength(1)
    })

    test("respects custom contexts", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      // Simulate config hook with custom context
      await plugin.config?.({
        prefillAssistant: {
          contexts: {
            jsonOutput: "{ // Custom JSON prefill",
          },
        },
      } as any)

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "Extract as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toEqual({
        role: "assistant",
        content: "{ // Custom JSON prefill",
      })
    })

    test("respects disabled pattern detection", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      await plugin.config?.({
        prefillAssistant: {
          patternDetection: false,
        },
      } as any)

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "Extract as JSON",
          agent: "general",
          conversationDepth: 5,
        },
        output,
      )

      // Pattern detection disabled, but agent prefill should still work
      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toEqual({
        role: "assistant",
        content: "[General Agent]",
      })
    })

    test("respects disabled agent prefilling", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      await plugin.config?.({
        prefillAssistant: {
          agentPrefilling: false,
        },
      } as any)

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "What should we do?",
          agent: "orchestrator",
          conversationDepth: 5,
        },
        output,
      )

      // Agent prefilling disabled, should not add prefill
      expect(output.messages).toHaveLength(1)
    })
  })

  describe("Priority", () => {
    test("pattern detection takes priority over agent prefilling", async () => {
      const plugin = await PrefillAssistantPlugin({
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        $: {} as any,
      })

      const output = {
        messages: [{ role: "user" as const, content: "test" }],
      }

      await plugin["chat.messages"]?.(
        {
          model: { id: "test", name: "test" } as any,
          provider: { id: "anthropic", name: "anthropic" } as any,
          userMessage: { id: "1", sessionID: "1", role: "user", time: { created: 0 } } as any,
          userText: "Extract as JSON for orchestrator",
          agent: "orchestrator",
          conversationDepth: 5,
        },
        output,
      )

      // Should use JSON prefill, not orchestrator prefill
      expect(output.messages).toHaveLength(2)
      expect(output.messages[1]).toEqual({
        role: "assistant",
        content: "{",
      })
    })
  })
})
