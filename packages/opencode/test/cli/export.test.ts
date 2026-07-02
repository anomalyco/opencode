import { expect, test } from "bun:test"
import { sanitize } from "../../src/cli/cmd/export"

test("sanitize redacts running tool raw input", () => {
  const data = {
    info: {
      id: "ses_test",
      title: "Safe title",
      directory: "C:\\repo",
      time: { created: 1, updated: 1 },
    },
    messages: [
      {
        info: {
          id: "msg_test",
          sessionID: "ses_test",
          role: "assistant",
          agent: "build",
          mode: "build",
          path: { cwd: "C:\\repo", root: "C:\\repo" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
          modelID: "test-model",
          providerID: "test",
          time: { created: 1 },
        },
        parts: [
          {
            id: "part_running",
            messageID: "msg_test",
            sessionID: "ses_test",
            type: "tool",
            tool: "bash",
            callID: "call_test",
            state: {
              status: "running",
              input: { command: "Write-Output secret-value" },
              raw: '{"command":"Write-Output secret-value"}',
              metadata: { output: "secret-value" },
              time: { start: 1 },
            },
          },
        ],
      },
    ],
  } as unknown as Parameters<typeof sanitize>[0]

  const result = sanitize(data)
  const part = result.messages[0]?.parts[0]
  expect(part?.type).toBe("tool")
  if (part?.type !== "tool") return
  expect(part.state.status).toBe("running")
  if (part.state.status !== "running") return
  expect(part.state.raw).toBe("[redacted:tool-raw:part_running]")
  expect(JSON.stringify(result)).not.toContain("secret-value")
})

test("sanitize drops unexpected error tool raw input", () => {
  const data = {
    info: {
      id: "ses_test",
      title: "Safe title",
      directory: "C:\\repo",
      time: { created: 1, updated: 1 },
    },
    messages: [
      {
        info: {
          id: "msg_test",
          sessionID: "ses_test",
          role: "assistant",
          agent: "build",
          mode: "build",
          path: { cwd: "C:\\repo", root: "C:\\repo" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
          modelID: "test-model",
          providerID: "test",
          time: { created: 1 },
        },
        parts: [
          {
            id: "part_error",
            messageID: "msg_test",
            sessionID: "ses_test",
            type: "tool",
            tool: "bash",
            callID: "call_test",
            state: {
              status: "error",
              input: {},
              error: "Tool execution aborted",
              raw: '{"command":"Write-Output raw-secret"}',
              metadata: { interrupted: true },
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ],
  } as unknown as Parameters<typeof sanitize>[0]

  const result = sanitize(data)
  const part = result.messages[0]?.parts[0]
  expect(part?.type).toBe("tool")
  if (part?.type !== "tool") return
  expect(part.state.status).toBe("error")
  if (part.state.status !== "error") return
  expect("raw" in part.state).toBe(false)
  expect(JSON.stringify(result)).not.toContain("raw-secret")
})
