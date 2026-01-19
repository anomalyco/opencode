import { describe, test, expect } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"
import type { ModelMessage } from "ai"

describe("ProviderTransform.message - Perplexity message alternation", () => {
  test("should ensure user-assistant alternation for Perplexity providers", () => {
    const perplexityModel = {
      id: "perplexity/sonar-pro",
      providerID: "perplexity",
      api: {
        id: "sonar-pro",
        url: "https://api.perplexity.ai",
        npm: "@ai-sdk/perplexity",
      },
      name: "Sonar Pro",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active" as const,
      options: {},
      headers: {},
      release_date: "2024-01-01",
    }

    // This simulates the problematic message sequence that could occur
    // when tools return attachments, creating consecutive user messages
    const messagesWithConsecutiveUsers: ModelMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Please analyze this file" },
      { role: "assistant", content: "I'll analyze the file for you." },
      {
        role: "user",
        content: "The tool read-file returned following attachments:",
      },
      {
        role: "user", // This consecutive user message violates Perplexity's requirements
        content: "Now please summarize the findings",
      },
    ]

    const result = ProviderTransform.message(messagesWithConsecutiveUsers, perplexityModel, {})

    // Check that consecutive user messages are properly handled
    const roles = result.map((msg) => msg.role)

    // Find consecutive user roles
    let hasConsecutiveUsers = false
    for (let i = 1; i < roles.length; i++) {
      if (roles[i] === "user" && roles[i - 1] === "user") {
        hasConsecutiveUsers = true
        break
      }
    }

    // After implementing fix, consecutive user messages should be merged
    expect(hasConsecutiveUsers).toBe(false)

    // Verify that the sequence now properly alternates (no consecutive users)
    const actualSequence = roles
    expect(actualSequence).toEqual(["system", "user", "assistant", "user"])

    // Verify that consecutive user messages were merged properly
    const userMessages = result.filter((msg) => msg.role === "user")
    expect(userMessages).toHaveLength(2) // First user message, then merged user message

    // The first user message should remain unchanged
    const firstUserMessage = userMessages[0]
    expect(firstUserMessage.content.toString()).toBe("Please analyze this file")

    // The second user message should contain merged content from both consecutive original user messages
    const secondUserMessage = userMessages[1]
    expect(secondUserMessage.content.toString()).toContain("The tool read-file returned following attachments:")
    expect(secondUserMessage.content.toString()).toContain("Now please summarize the findings")
  })
})
