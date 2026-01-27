import { describe, test, expect, mock } from "bun:test"
import { TOONTransform } from "../src/session/toon-transform"
import { TOONMetadata } from "../src/session/toon-metadata"
import type { ModelMessage } from "ai"

// Mock Config to control TOON settings
const mockConfig = {
  get: mock(async () => ({
    experimental: {
      toon_format: {
        enabled: true,
        mode: "balanced" as const,
        preserve_code: true,
      },
    },
  })),
}

// Replace Config import with mock
mock.module("../src/config/config", () => ({
  Config: mockConfig,
}))

describe("TOON Transform Integration", () => {
  const sessionID = "integration-test-session"

  describe("Message Transformation", () => {
    test("transforms user messages when enabled", async () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: "Create a function that returns the value",
        },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe("user")
      expect(typeof result.messages[0].content).toBe("string")
      
      // Content should be transformed
      const content = result.messages[0].content as string
      expect(content).toContain("fn")
      expect(content.length).toBeLessThan((messages[0].content as string).length)
    })

    test("preserves system messages", async () => {
      const messages: ModelMessage[] = [
        {
          role: "system",
          content: "You are a helpful assistant",
        },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      expect(result.messages[0].content).toBe("You are a helpful assistant")
    })

    test("handles multi-part messages", async () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Create a function with parameters" },
            { type: "text", text: "The function should return a value" },
          ],
        },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      expect(Array.isArray(result.messages[0].content)).toBe(true)
      const parts = result.messages[0].content as any[]
      
      expect(parts[0].text).toContain("fn")
      expect(parts[0].text).toContain("param")
      expect(parts[1].text).toContain("ret")
    })

    test("preserves non-text parts in multi-part messages", async () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this image" },
            { type: "image", image: "data:image/png;base64,..." },
          ],
        },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      const parts = result.messages[0].content as any[]
      expect(parts).toHaveLength(2)
      expect(parts[0].type).toBe("text")
      expect(parts[1].type).toBe("image")
      expect(parts[1].image).toBe("data:image/png;base64,...")
    })

    test("handles mixed message types", async () => {
      const messages: ModelMessage[] = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Create a function" },
        { role: "assistant", content: "Here is the function" },
        { role: "user", content: "Modify the parameter" },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      expect(result.messages).toHaveLength(4)
      expect(result.messages[0].content).toBe("System prompt") // Unchanged
      expect((result.messages[1].content as string)).toContain("fn") // Transformed
      expect((result.messages[2].content as string)).toContain("fn") // Transformed
      expect((result.messages[3].content as string)).toContain("param") // Transformed
    })
  })

  describe("Savings Calculation", () => {
    test("calculates savings correctly", async () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: "Create a function that takes a parameter and returns the value",
        },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      expect(result.savings.tokensSaved).toBeGreaterThan(0)
      expect(result.savings.originalTokens).toBeGreaterThan(0)
      expect(result.savings.transformedTokens).toBeGreaterThan(0)
      expect(result.savings.savingsPercentage).toBeGreaterThan(0)
      expect(result.savings.savingsPercentage).toBeLessThan(100)
    })

    test("records savings in metadata", async () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: "Configure the application database",
        },
      ]

      await TOONTransform.transform(messages, sessionID)

      const savedMetadata = TOONMetadata.getSavings(sessionID)
      expect(savedMetadata).toBeDefined()
      expect(savedMetadata?.tokensSaved).toBeGreaterThan(0)
      expect(savedMetadata?.mode).toBe("balanced")
    })

    test("accumulates savings across multiple messages", async () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Create a function with parameters" },
        { role: "assistant", content: "Here is the function implementation" },
        { role: "user", content: "Update the configuration settings" },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      // Should accumulate savings from all transformed messages
      expect(result.savings.tokensSaved).toBeGreaterThan(5)
    })
  })

  describe("Code Preservation", () => {
    test("preserves code blocks in messages", async () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: `Refactor this function:
\`\`\`typescript
function calculateTotal(items: Item[]) {
  return items.reduce((sum, item) => sum + item.price, 0)
}
\`\`\`
Make it more efficient.`,
        },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      const content = result.messages[0].content as string
      expect(content).toContain("```typescript")
      expect(content).toContain("function calculateTotal")
      expect(content).toContain("reduce")
      expect(content).toContain("```")
    })

    test("transforms text around code blocks", async () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: `Create a function like this:
\`\`\`js
function test() {}
\`\`\`
The function should have parameters.`,
        },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      const content = result.messages[0].content as string
      
      // Code preserved
      expect(content).toContain("function test()")
      
      // Surrounding text transformed
      expect(content).toContain("fn")
      expect(content).toContain("param")
    })
  })

  describe("Configuration Handling", () => {
    test("returns original messages when TOON disabled", async () => {
      // Temporarily mock disabled config
      const originalGet = mockConfig.get
      mockConfig.get = mock(async () => ({
        experimental: {
          toon_format: {
            enabled: false,
            mode: "balanced" as const,
            preserve_code: true,
          },
        },
      }))

      const messages: ModelMessage[] = [
        { role: "user", content: "Create a function" },
      ]

      const result = await TOONTransform.transform(messages)

      expect(result.messages[0].content).toBe("Create a function")
      expect(result.savings.tokensSaved).toBe(0)

      // Restore original mock
      mockConfig.get = originalGet
    })

    test("respects different modes", async () => {
      const testModes = ["compact", "balanced", "verbose"] as const

      for (const mode of testModes) {
        mockConfig.get = mock(async () => ({
          experimental: {
            toon_format: {
              enabled: true,
              mode,
              preserve_code: true,
            },
          },
        }))

        const messages: ModelMessage[] = [
          { role: "user", content: "Create a function with parameters" },
        ]

        const result = await TOONTransform.transform(messages, `session-${mode}`)

        // All modes should transform
        const content = result.messages[0].content as string
        expect(content.length).toBeLessThanOrEqual((messages[0].content as string).length)
      }
    })
  })

  describe("Edge Cases", () => {
    test("handles empty message array", async () => {
      const result = await TOONTransform.transform([])

      expect(result.messages).toHaveLength(0)
      expect(result.savings.tokensSaved).toBe(0)
    })

    test("handles messages with empty content", async () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "" },
      ]

      const result = await TOONTransform.transform(messages)

      expect(result.messages[0].content).toBe("")
      expect(result.savings.tokensSaved).toBe(0)
    })

    test("handles very long messages", async () => {
      const longText = "Create a function that takes a parameter ".repeat(100)
      const messages: ModelMessage[] = [
        { role: "user", content: longText },
      ]

      const result = await TOONTransform.transform(messages, sessionID)

      expect(result.savings.tokensSaved).toBeGreaterThan(50)
      expect((result.messages[0].content as string).length).toBeLessThan(longText.length)
    })

    test("handles messages without sessionID", async () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Create a function" },
      ]

      const result = await TOONTransform.transform(messages)

      // Should still transform, just not record metadata
      expect(result.messages[0].content).not.toBe("Create a function")
      expect(result.savings.tokensSaved).toBeGreaterThan(0)
    })
  })

  describe("Real-World Scenarios", () => {
    test("scenario: refactoring request", async () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: `I need to refactor the following function to use modern TypeScript:
\`\`\`typescript
function processData(data) {
  var result = []
  for (var i = 0; i < data.length; i++) {
    result.push(data[i].value)
  }
  return result
}
\`\`\`
Please add type annotations and use array methods.`,
        },
      ]

      const result = await TOONTransform.transform(messages, "refactor-session")

      const content = result.messages[0].content as string
      
      // Code preserved
      expect(content).toContain("function processData")
      expect(content).toContain("for (var i = 0")
      
      // Text transformed
      expect(content).toContain("fn")
      
      // Should have meaningful savings
      expect(result.savings.savingsPercentage).toBeGreaterThan(10)
    })

    test("scenario: configuration help", async () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: "I need help configuring the application to connect to the production database server",
        },
      ]

      const result = await TOONTransform.transform(messages, "config-session")

      const content = result.messages[0].content as string
      
      expect(content).toContain("config")
      expect(content).toContain("app")
      expect(content).toContain("db")
      expect(result.savings.tokensSaved).toBeGreaterThan(3)
    })

    test("scenario: multi-turn conversation", async () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Create a function to calculate totals" },
        { role: "assistant", content: "Here is a function that returns the total value" },
        { role: "user", content: "Add a parameter for the tax rate" },
        { role: "assistant", content: "Updated the function with a parameter" },
        { role: "user", content: "Can you add error handling to the function?" },
      ]

      const result = await TOONTransform.transform(messages, "conversation-session")

      // All user and assistant messages should be transformed
      expect(result.messages).toHaveLength(5)
      
      // Should have accumulated significant savings
      expect(result.savings.tokensSaved).toBeGreaterThan(15)
      expect(result.savings.savingsPercentage).toBeGreaterThan(15)
    })
  })
})
