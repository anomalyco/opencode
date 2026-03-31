import { describe, expect, test } from "bun:test"
import { PermissionRouter, PermissionClassifier } from "@/permission"

describe("PermissionRouter", () => {
  test("should have built-in tool classifications", () => {
    expect(PermissionRouter.BuiltinToolClassifications.read).toBeDefined()
    expect(PermissionRouter.BuiltinToolClassifications.bash).toBeDefined()
    expect(PermissionRouter.BuiltinToolClassifications.write).toBeDefined()
    expect(PermissionRouter.BuiltinToolClassifications.edit).toBeDefined()
  })

  test("read tool should be read-only", () => {
    const readTool = PermissionRouter.BuiltinToolClassifications.read
    expect(readTool.flags.isReadOnly).toBe(true)
    expect(readTool.flags.isDestructive).toBe(false)
    expect(readTool.defaultRisk).toBe("low")
    expect(readTool.requiredApprovals).toContain("auto")
  })

  test("bash tool should be destructive and require user approval", () => {
    const bashTool = PermissionRouter.BuiltinToolClassifications.bash
    expect(bashTool.flags.isReadOnly).toBe(false)
    expect(bashTool.flags.isDestructive).toBe(true)
    expect(bashTool.flags.isSystem).toBe(true)
    expect(bashTool.defaultRisk).toBe("high")
    expect(bashTool.requiredApprovals).toContain("user")
  })

  test("write tool should be destructive", () => {
    const writeTool = PermissionRouter.BuiltinToolClassifications.write
    expect(writeTool.flags.isDestructive).toBe(true)
    expect(writeTool.defaultRisk).toBe("medium")
    expect(writeTool.requiredApprovals).toContain("user")
  })

  test("network tools should use classifier", () => {
    const webfetch = PermissionRouter.BuiltinToolClassifications.webfetch
    expect(webfetch.flags.isNetwork).toBe(true)
    expect(webfetch.requiredApprovals).toContain("classifier")

    const websearch = PermissionRouter.BuiltinToolClassifications.websearch
    expect(websearch.flags.isNetwork).toBe(true)
    expect(websearch.requiredApprovals).toContain("classifier")
  })
})

describe("PermissionClassifier", () => {
  test("should parse valid classification response", () => {
    const response = JSON.stringify({
      riskLevel: "low",
      confidence: 0.95,
      reasoning: "Safe read operation",
      suggestedAction: "allow",
      requiresHumanReview: false,
    })

    const result = PermissionClassifier.parseResponse(response)
    expect(result.riskLevel).toBe("low")
    expect(result.confidence).toBe(0.95)
    expect(result.suggestedAction).toBe("allow")
    expect(result.requiresHumanReview).toBe(false)
  })

  test("should handle invalid JSON gracefully", () => {
    const result = PermissionClassifier.parseResponse("invalid json")
    expect(result.riskLevel).toBe("medium")
    expect(result.confidence).toBe(0.5)
    expect(result.suggestedAction).toBe("ask")
    expect(result.requiresHumanReview).toBe(true)
  })

  test("should determine action for critical risk", () => {
    const classification = {
      riskLevel: "critical" as const,
      confidence: 0.9,
      reasoning: "Dangerous",
      suggestedAction: "deny" as const,
      requiresHumanReview: true,
    }

    const def = PermissionRouter.BuiltinToolClassifications.bash
    const action = PermissionClassifier.determineAction(classification, def)
    expect(action).toBe("deny")
  })

  test("should determine action for low risk read-only tool", () => {
    const classification = {
      riskLevel: "low" as const,
      confidence: 0.95,
      reasoning: "Safe",
      suggestedAction: "allow" as const,
      requiresHumanReview: false,
    }

    const def = PermissionRouter.BuiltinToolClassifications.read
    const action = PermissionClassifier.determineAction(classification, def)
    expect(action).toBe("allow")
  })

  test("should generate cache key consistently", () => {
    const req = {
      toolId: "read",
      params: { filePath: "/test.txt" },
      sessionID: "test-session",
      context: { cwd: "/", previousCalls: [] },
    }

    const key1 = PermissionClassifier.getCacheKey(req)
    const key2 = PermissionClassifier.getCacheKey(req)
    expect(key1).toBe(key2)
    expect(key1).toContain("read")
  })

  test("should create prompt with tool info", () => {
    const req = {
      toolId: "bash",
      params: { command: "ls -la" },
      sessionID: "test",
      context: { cwd: "/home", previousCalls: [] },
    }

    const def = PermissionRouter.BuiltinToolClassifications.bash
    const prompt = PermissionClassifier.createPrompt(req, def)

    expect(prompt).toContain("bash")
    expect(prompt).toContain("ls -la")
    expect(prompt).toContain("/home")
    expect(prompt).toContain("Destructive: true")
  })
})
