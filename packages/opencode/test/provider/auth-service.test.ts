import { test, expect, describe } from "bun:test"
import { serializeCondition, Method, MethodPrompt, MethodPromptOption } from "../../src/provider/auth-service"

describe("serializeCondition", () => {
  test("serializes arrow function with strict equality", () => {
    const fn = (inputs: Record<string, string>) => inputs.type === "enterprise"
    expect(serializeCondition(fn)).toBe("type:enterprise")
  })

  test("serializes arrow function with loose equality", () => {
    const fn = (inputs: Record<string, string>) => inputs.mode == "cloud"
    expect(serializeCondition(fn)).toBe("mode:cloud")
  })

  test("passes through already-serialized string", () => {
    expect(serializeCondition("type:enterprise")).toBe("type:enterprise")
  })

  test("returns undefined for non-function non-string", () => {
    expect(serializeCondition(undefined)).toBeUndefined()
    expect(serializeCondition(null)).toBeUndefined()
    expect(serializeCondition(42)).toBeUndefined()
    expect(serializeCondition({})).toBeUndefined()
  })

  test("returns undefined for unrecognized function pattern", () => {
    const fn = () => true
    expect(serializeCondition(fn)).toBeUndefined()
  })

  test("handles single-quoted values", () => {
    const fn = (inputs: Record<string, string>) => inputs.org === "myorg"
    expect(serializeCondition(fn)).toBe("org:myorg")
  })

  test("handles backtick-quoted values", () => {
    const fn = (inputs: Record<string, string>) => inputs.env === `prod`
    expect(serializeCondition(fn)).toBe("env:prod")
  })
})

describe("MethodPromptOption schema", () => {
  test("parses valid option", () => {
    const result = MethodPromptOption.parse({ label: "Org A", value: "org-a" })
    expect(result.label).toBe("Org A")
    expect(result.value).toBe("org-a")
  })

  test("parses option with hint", () => {
    const result = MethodPromptOption.parse({ label: "Org A", value: "org-a", hint: "Primary org" })
    expect(result.hint).toBe("Primary org")
  })

  test("rejects missing required fields", () => {
    expect(() => MethodPromptOption.parse({ label: "Org A" })).toThrow()
    expect(() => MethodPromptOption.parse({ value: "org-a" })).toThrow()
  })
})

describe("MethodPrompt schema", () => {
  test("parses select prompt", () => {
    const result = MethodPrompt.parse({
      type: "select",
      key: "org",
      message: "Select organization",
      options: [{ label: "Org A", value: "org-a" }],
    })
    expect(result.type).toBe("select")
    expect(result.options).toHaveLength(1)
  })

  test("parses text prompt", () => {
    const result = MethodPrompt.parse({
      type: "text",
      key: "domain",
      message: "Enter domain",
      placeholder: "github.example.com",
    })
    expect(result.type).toBe("text")
    expect(result.placeholder).toBe("github.example.com")
  })

  test("parses prompt with conditional", () => {
    const result = MethodPrompt.parse({
      type: "text",
      key: "url",
      message: "Enter URL",
      conditional: "type:enterprise",
    })
    expect(result.conditional).toBe("type:enterprise")
  })

  test("rejects invalid type", () => {
    expect(() => MethodPrompt.parse({ type: "radio", key: "x", message: "y" })).toThrow()
  })
})

describe("Method schema", () => {
  test("parses oauth method with prompts", () => {
    const result = Method.parse({
      type: "oauth",
      label: "GitHub Copilot",
      prompts: [
        { type: "select", key: "type", message: "Select type" },
        { type: "text", key: "domain", message: "Enter domain", conditional: "type:enterprise" },
      ],
    })
    expect(result.type).toBe("oauth")
    expect(result.prompts).toHaveLength(2)
  })

  test("parses method without prompts (backward compatible)", () => {
    const result = Method.parse({ type: "api", label: "API key" })
    expect(result.prompts).toBeUndefined()
  })
})
