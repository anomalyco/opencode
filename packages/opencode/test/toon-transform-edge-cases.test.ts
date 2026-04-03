import { describe, test, expect, afterEach, spyOn, mock } from "bun:test"
import { Config } from "../src/config/config"
import { TOONTransform } from "../src/session/toon-transform"
import type { ModelMessage } from "ai"

afterEach(() => mock.restore())

describe("TOON Transform Edge Cases", () => {
  describe("Configuration Handling", () => {
    test("handles missing experimental config", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({} as any)
      const messages: ModelMessage[] = [{ role: "user", content: "test message" }]
      const result = await TOONTransform.transform(messages)
      expect(result.messages).toEqual(messages)
      expect(result.savings.tokensSaved).toBe(0)
    })

    test("handles missing toon_format config", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({ experimental: {} } as any)
      const messages: ModelMessage[] = [{ role: "user", content: "test message" }]
      const result = await TOONTransform.transform(messages)
      expect(result.messages).toEqual(messages)
      expect(result.savings.tokensSaved).toBe(0)
    })

    test("uses default values when mode not specified", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true } },
      } as any)
      const messages: ModelMessage[] = [{ role: "user", content: "Create a function" }]
      const result = await TOONTransform.transform(messages)
      expect(result.messages[0].content).toContain("fn")
    })

    test("uses preserve_code default when not specified", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "balanced" as const } },
      } as any)
      const messages: ModelMessage[] = [
        { role: "user", content: "Code: ```ts\nfunction test() {}\n``` Create a function" },
      ]
      const result = await TOONTransform.transform(messages)
      expect(result.messages[0].content).toContain("function test()")
    })
  })

  describe("Message Role Handling", () => {
    test("preserves system messages unchanged", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "compact" as const, preserve_code: true } },
      } as any)
      const systemMessage = "You are a helpful assistant with functions"
      const messages: ModelMessage[] = [{ role: "system", content: systemMessage }]
      const result = await TOONTransform.transform(messages)
      expect(result.messages[0].content).toBe(systemMessage)
      expect(result.savings.tokensSaved).toBe(0)
    })

    test("preserves tool messages unchanged", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "compact" as const, preserve_code: true } },
      } as any)
      const toolMessage = "Tool result with function data"
      const messages: ModelMessage[] = [{ role: "tool", content: toolMessage, toolCallId: "123" } as any]
      const result = await TOONTransform.transform(messages)
      expect(result.messages[0].content).toBe(toolMessage)
    })
  })

  describe("Empty and Edge Cases", () => {
    test("handles empty message array", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "balanced" as const, preserve_code: true } },
      } as any)
      const result = await TOONTransform.transform([])
      expect(result.messages).toEqual([])
      expect(result.savings.tokensSaved).toBe(0)
      expect(result.savings.savingsPercentage).toBe(0)
    })

    test("handles empty string content", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "balanced" as const, preserve_code: true } },
      } as any)
      const messages: ModelMessage[] = [{ role: "user", content: "" }]
      const result = await TOONTransform.transform(messages)
      expect(result.messages[0].content).toBe("")
      expect(result.savings.tokensSaved).toBe(0)
    })

    test("handles messages with only whitespace", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "balanced" as const, preserve_code: true } },
      } as any)
      const messages: ModelMessage[] = [{ role: "user", content: "   \n  \t  " }]
      const result = await TOONTransform.transform(messages)
      expect(result.messages[0].content).toBe("")
    })
  })

  describe("Multi-part Message Edge Cases", () => {
    test("handles empty multi-part array", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "balanced" as const, preserve_code: true } },
      } as any)
      const messages: ModelMessage[] = [{ role: "user", content: [] }]
      const result = await TOONTransform.transform(messages)
      expect(result.messages[0].content).toEqual([])
    })

    test("handles multi-part with only non-text parts", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "balanced" as const, preserve_code: true } },
      } as any)
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "image", image: "data:image/png;base64,..." },
            { type: "image", image: "data:image/jpeg;base64,..." },
          ],
        },
      ]
      const result = await TOONTransform.transform(messages)
      expect(result.messages[0].content).toEqual(messages[0].content)
      expect(result.savings.tokensSaved).toBe(0)
    })

    test("handles mixed text and non-text parts with empty text", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "balanced" as const, preserve_code: true } },
      } as any)
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "" },
            { type: "image", image: "data:image/png;base64,..." },
          ],
        },
      ]
      const result = await TOONTransform.transform(messages)
      const parts = result.messages[0].content as any[]
      expect(parts[0].text).toBe("")
      expect(parts[1].image).toBe("data:image/png;base64,...")
    })
  })

  describe("Savings Calculation Edge Cases", () => {
    test("calculates zero savings when no transformation occurs", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "verbose" as const, preserve_code: true } },
      } as any)
      const messages: ModelMessage[] = [{ role: "user", content: "xyz abc def" }]
      const result = await TOONTransform.transform(messages)
      expect(result.savings.tokensSaved).toBe(0)
    })

    test("correctly accumulates savings across multiple messages", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "compact" as const, preserve_code: true } },
      } as any)
      const messages: ModelMessage[] = [
        { role: "user", content: "Create a function" },
        { role: "assistant", content: "Here is the function" },
        { role: "user", content: "Add a parameter" },
      ]
      const result = await TOONTransform.transform(messages)
      expect(result.savings.tokensSaved).toBeGreaterThanOrEqual(5)
      expect(result.savings.originalTokens).toBeGreaterThan(0)
      expect(result.savings.transformedTokens).toBeGreaterThan(0)
    })

    test("handles division by zero in percentage calculation", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "balanced" as const, preserve_code: true } },
      } as any)
      const messages: ModelMessage[] = [{ role: "user", content: "" }]
      const result = await TOONTransform.transform(messages)
      expect(result.savings.savingsPercentage).toBe(0)
      expect(result.savings.originalTokens).toBe(0)
    })
  })

  describe("Session ID Handling", () => {
    test("does not record metadata when sessionID not provided", async () => {
      spyOn(Config, "get").mockResolvedValueOnce({
        experimental: { toon_format: { enabled: true, mode: "balanced" as const, preserve_code: true } },
      } as any)
      const messages: ModelMessage[] = [{ role: "user", content: "Create a function" }]
      const result = await TOONTransform.transform(messages)
      expect(result.messages[0].content).toContain("fn")
      expect(result.savings.tokensSaved).toBeGreaterThan(0)
    })
  })
})
