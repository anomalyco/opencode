import { describe, expect, test } from "bun:test"
import { parseModel } from "../../src/tool/task"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("tool.task parseModel", () => {
  test("parses valid provider/model format", () => {
    const result = parseModel("anthropic/claude-opus-4-0520")
    expect(String(result.providerID)).toBe("anthropic")
    expect(String(result.modelID)).toBe("claude-opus-4-0520")
  })

  test("parses model with nested slashes", () => {
    const result = parseModel("amazon-bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0")
    expect(String(result.providerID)).toBe("amazon-bedrock")
    expect(String(result.modelID)).toBe("us.anthropic.claude-sonnet-4-20250514-v1:0")
  })

  test("parses simple provider/model", () => {
    const result = parseModel("openai/gpt-4")
    expect(String(result.providerID)).toBe("openai")
    expect(String(result.modelID)).toBe("gpt-4")
  })

  test("throws on missing slash", () => {
    expect(() => parseModel("just-a-model")).toThrow(
      'Invalid model format "just-a-model". Expected "provider/model-id"',
    )
  })

  test("throws on empty string", () => {
    expect(() => parseModel("")).toThrow('Invalid model format "". Expected "provider/model-id"')
  })

  test("handles slash at start (empty provider)", () => {
    const result = parseModel("/model-id")
    expect(String(result.providerID)).toBe("")
    expect(String(result.modelID)).toBe("model-id")
  })

  test("handles slash at end (empty model)", () => {
    const result = parseModel("provider/")
    expect(String(result.providerID)).toBe("provider")
    expect(String(result.modelID)).toBe("")
  })
})

describe("model_override permission", () => {
  test("denied by default", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Agent } = await import("../../src/agent/agent")
        const build = await Agent.get("build")
        expect(
          PermissionNext.evaluate("model_override", "anthropic/claude-opus-4-0520", build!.permission).action,
        ).toBe("deny")
      },
    })
  })

  test("allow specific model via config", async () => {
    await using tmp = await tmpdir({
      config: {
        permission: {
          model_override: {
            "anthropic/claude-opus-4-0520": "allow",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Agent } = await import("../../src/agent/agent")
        const build = await Agent.get("build")
        expect(
          PermissionNext.evaluate("model_override", "anthropic/claude-opus-4-0520", build!.permission).action,
        ).toBe("allow")
        expect(PermissionNext.evaluate("model_override", "openai/gpt-4o", build!.permission).action).toBe("deny")
      },
    })
  })

  test("allow entire provider via wildcard", async () => {
    await using tmp = await tmpdir({
      config: {
        permission: {
          model_override: {
            "anthropic/*": "allow",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Agent } = await import("../../src/agent/agent")
        const build = await Agent.get("build")
        expect(
          PermissionNext.evaluate("model_override", "anthropic/claude-opus-4-0520", build!.permission).action,
        ).toBe("allow")
        expect(
          PermissionNext.evaluate("model_override", "anthropic/claude-haiku-4-20250514", build!.permission).action,
        ).toBe("allow")
        expect(PermissionNext.evaluate("model_override", "openai/gpt-4o", build!.permission).action).toBe("deny")
      },
    })
  })

  test("allow all models via simple allow", async () => {
    await using tmp = await tmpdir({
      config: {
        permission: {
          model_override: "allow",
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Agent } = await import("../../src/agent/agent")
        const build = await Agent.get("build")
        expect(
          PermissionNext.evaluate("model_override", "anthropic/claude-opus-4-0520", build!.permission).action,
        ).toBe("allow")
        expect(PermissionNext.evaluate("model_override", "openai/gpt-4o", build!.permission).action).toBe("allow")
        expect(PermissionNext.evaluate("model_override", "google/gemini-2.5-pro", build!.permission).action).toBe(
          "allow",
        )
      },
    })
  })

  test("ask for specific model", async () => {
    await using tmp = await tmpdir({
      config: {
        permission: {
          model_override: {
            "openai/*": "ask",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Agent } = await import("../../src/agent/agent")
        const build = await Agent.get("build")
        expect(PermissionNext.evaluate("model_override", "openai/gpt-4o", build!.permission).action).toBe("ask")
        expect(
          PermissionNext.evaluate("model_override", "anthropic/claude-opus-4-0520", build!.permission).action,
        ).toBe("deny")
      },
    })
  })

  test("per-agent model_override permission", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          build: {
            permission: {
              model_override: {
                "anthropic/*": "allow",
              },
            },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Agent } = await import("../../src/agent/agent")
        const build = await Agent.get("build")
        expect(
          PermissionNext.evaluate("model_override", "anthropic/claude-opus-4-0520", build!.permission).action,
        ).toBe("allow")
        expect(PermissionNext.evaluate("model_override", "openai/gpt-4o", build!.permission).action).toBe("deny")
      },
    })
  })
})
