import { describe, test, expect, beforeEach } from "bun:test"
import { ToolGuardrails } from "../../src/session/tool-guardrails"

describe("ToolGuardrails", () => {
  const testSessionID = "test-session-123"

  beforeEach(() => {
    // Clean up before each test
    ToolGuardrails.cleanup(testSessionID)
  })

  describe("Dangerous Pattern Detection", () => {
    test("detects rm -rf pattern", () => {
      const result = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID,
        command: "rm -rf /some/path",
      })

      expect(result.dangerousPatterns).toContain("rm -rf")
      expect(result.requiresConfirmation).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    test("detects fork bomb pattern", () => {
      const result = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID,
        command: ":(){ :|:& };:",
      })

      expect(result.dangerousPatterns).toContain(":(){ :|:& };:")
      expect(result.requiresConfirmation).toBe(true)
    })

    test("detects chmod 777 pattern", () => {
      const result = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID,
        command: "chmod 777 /var/www",
      })

      expect(result.dangerousPatterns).toContain("chmod 777")
      expect(result.warnings.some((w) => w.includes("security risk"))).toBe(true)
    })

    test("detects mkfs pattern", () => {
      const result = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID,
        command: "mkfs.ext4 /dev/sda1",
      })

      expect(result.dangerousPatterns).toContain("mkfs")
      expect(result.requiresConfirmation).toBe(true)
    })

    test("allows safe commands", () => {
      const result = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID,
        command: "ls -la",
      })

      expect(result.safe).toBe(true)
      expect(result.dangerousPatterns.length).toBe(0)
      expect(result.warnings.length).toBe(0)
      expect(result.requiresConfirmation).toBe(false)
    })
  })

  describe("Recursive Pattern Detection", () => {
    test("detects recursive tool calls", () => {
      // Call the same command multiple times
      const command = "echo 'test'"

      ToolGuardrails.lintBashCommand({ sessionID: testSessionID, command })
      ToolGuardrails.recordToolCall(testSessionID, "bash", { command })

      ToolGuardrails.lintBashCommand({ sessionID: testSessionID, command })
      ToolGuardrails.recordToolCall(testSessionID, "bash", { command })

      ToolGuardrails.lintBashCommand({ sessionID: testSessionID, command })
      ToolGuardrails.recordToolCall(testSessionID, "bash", { command })

      // Fourth call should trigger recursive detection
      const result = ToolGuardrails.lintBashCommand({ sessionID: testSessionID, command })

      expect(result.safe).toBe(false)
      expect(result.errors.some((e) => e.includes("Recursive"))).toBe(true)
    })

    test("resets recursive count for different commands", () => {
      // Call same command twice
      ToolGuardrails.lintBashCommand({ sessionID: testSessionID, command: "echo 'test1'" })
      ToolGuardrails.recordToolCall(testSessionID, "bash", { command: "echo 'test1'" })

      ToolGuardrails.lintBashCommand({ sessionID: testSessionID, command: "echo 'test1'" })
      ToolGuardrails.recordToolCall(testSessionID, "bash", { command: "echo 'test1'" })

      // Call different command
      const result = ToolGuardrails.lintBashCommand({ sessionID: testSessionID, command: "ls" })
      ToolGuardrails.recordToolCall(testSessionID, "bash", { command: "ls" })

      expect(result.safe).toBe(true)
      expect(result.errors.length).toBe(0)
    })
  })

  describe("Generic Tool Call Linting", () => {
    test("detects recursive tool calls for any tool", () => {
      const params = { file: "test.txt", content: "hello" }

      // Call same tool with same params multiple times
      ToolGuardrails.recordToolCall(testSessionID, "write", params)
      ToolGuardrails.recordToolCall(testSessionID, "write", params)
      ToolGuardrails.recordToolCall(testSessionID, "write", params)

      const result = ToolGuardrails.lintToolCall({
        sessionID: testSessionID,
        toolName: "write",
        params,
      })

      expect(result.safe).toBe(false)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.consecutiveCount).toBe(3)
    })

    test("allows different tool calls", () => {
      ToolGuardrails.recordToolCall(testSessionID, "read", { file: "test1.txt" })
      ToolGuardrails.recordToolCall(testSessionID, "write", { file: "test2.txt", content: "hello" })
      ToolGuardrails.recordToolCall(testSessionID, "read", { file: "test3.txt" })

      const result = ToolGuardrails.lintToolCall({
        sessionID: testSessionID,
        toolName: "read",
        params: { file: "test4.txt" },
      })

      expect(result.safe).toBe(true)
      expect(result.warnings.length).toBe(0)
    })
  })

  describe("Additional Safety Checks", () => {
    test("warns about sudo rm combination", () => {
      const result = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID,
        command: "sudo rm -rf /tmp/test",
      })

      expect(result.warnings.some((w) => w.includes("sudo") && w.includes("rm"))).toBe(true)
      expect(result.requiresConfirmation).toBe(true)
    })

    test("warns about recursive force deletion", () => {
      const result = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID,
        command: "rm --recursive --force /data",
      })

      expect(result.warnings.some((w) => w.includes("Recursive force deletion"))).toBe(true)
    })

    test("warns about disk device writes", () => {
      const result = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID,
        command: "dd if=/dev/zero > /dev/sda",
      })

      expect(result.warnings.some((w) => w.includes("disk devices"))).toBe(true)
      expect(result.dangerousPatterns).toContain("> /dev/")
    })
  })

  describe("History Management", () => {
    test("maintains tool call history", () => {
      ToolGuardrails.recordToolCall(testSessionID, "read", { file: "test1.txt" })
      ToolGuardrails.recordToolCall(testSessionID, "write", { file: "test2.txt" })

      const history = ToolGuardrails.getToolCallHistory(testSessionID)

      expect(history.length).toBe(2)
      expect(history[0].toolName).toBe("read")
      expect(history[1].toolName).toBe("write")
    })

    test("cleans up session history", () => {
      ToolGuardrails.recordToolCall(testSessionID, "read", { file: "test.txt" })

      let history = ToolGuardrails.getToolCallHistory(testSessionID)
      expect(history.length).toBe(1)

      ToolGuardrails.cleanup(testSessionID)

      history = ToolGuardrails.getToolCallHistory(testSessionID)
      expect(history.length).toBe(0)
    })

    test("limits history to last 20 calls", () => {
      // Record 25 calls
      for (let i = 0; i < 25; i++) {
        ToolGuardrails.recordToolCall(testSessionID, "read", { file: `test${i}.txt` })
      }

      const history = ToolGuardrails.getToolCallHistory(testSessionID)

      // Should only keep last 20
      expect(history.length).toBeLessThanOrEqual(20)
    })
  })

  describe("Case Sensitivity", () => {
    test("detects patterns case-insensitively", () => {
      const result1 = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID,
        command: "RM -RF /test",
      })

      const result2 = ToolGuardrails.lintBashCommand({
        sessionID: testSessionID + "2",
        command: "Rm -Rf /test",
      })

      expect(result1.dangerousPatterns.length).toBeGreaterThan(0)
      expect(result2.dangerousPatterns.length).toBeGreaterThan(0)
    })
  })
})
