import { test, expect, afterAll } from "bun:test"
import { CopilotAuthPlugin } from "../../src/plugin/copilot"

// Capture server to verify request headers
let capturedHeaders: Headers | null = null
const server = Bun.serve({
  port: 0,
  fetch(req) {
    capturedHeaders = req.headers
    return new Response(JSON.stringify({ id: "msg_123", content: [], type: "message" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  },
})

afterAll(() => {
  server.stop()
})

async function getWrappedFetch() {
  const hooks = await CopilotAuthPlugin({
    client: {} as any,
    project: {} as any,
    worktree: {} as any,
    directory: new URL("file:///tmp") as any,
    serverUrl: new URL("http://localhost:4096") as any,
    $: Bun.$,
  })

  const auth = await hooks.auth!.loader!(
    async () => ({ type: "oauth" as const, refresh: "test-token", access: "test-token", expires: 0 }),
    undefined as any,
  )

  return auth.fetch!
}

test("tool_result in last user message sets x-initiator: agent", async () => {
  const wrappedFetch = await getWrappedFetch()
  capturedHeaders = null

  const body = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    messages: [
      { role: "user", content: [{ type: "text", text: "Use the tool" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_123", name: "bash", input: { command: "ls" } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_123", content: "file1.txt\nfile2.txt" }],
      },
    ],
  })

  await wrappedFetch(`${server.url.origin}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })

  expect(capturedHeaders).not.toBeNull()
  expect(capturedHeaders!.get("x-initiator")).toBe("agent")
})

test("mixed text + tool_result sets x-initiator: agent", async () => {
  const wrappedFetch = await getWrappedFetch()
  capturedHeaders = null

  const body = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    messages: [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_123", content: "done" },
          { type: "text", text: "continue please" },
        ],
      },
    ],
  })

  await wrappedFetch(`${server.url.origin}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })

  expect(capturedHeaders).not.toBeNull()
  expect(capturedHeaders!.get("x-initiator")).toBe("agent")
})

test("normal user text sets x-initiator: user", async () => {
  const wrappedFetch = await getWrappedFetch()
  capturedHeaders = null

  const body = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    messages: [{ role: "user", content: [{ type: "text", text: "Hello world" }] }],
  })

  await wrappedFetch(`${server.url.origin}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })

  expect(capturedHeaders).not.toBeNull()
  expect(capturedHeaders!.get("x-initiator")).toBe("user")
})

test("string content sets x-initiator: user", async () => {
  const wrappedFetch = await getWrappedFetch()
  capturedHeaders = null

  const body = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    messages: [{ role: "user", content: "Hello world" }],
  })

  await wrappedFetch(`${server.url.origin}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })

  expect(capturedHeaders).not.toBeNull()
  expect(capturedHeaders!.get("x-initiator")).toBe("user")
})

test("assistant last message should set x-initiator: agent", async () => {
  const wrappedFetch = await getWrappedFetch()
  capturedHeaders = null

  const body = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    ],
  })

  await wrappedFetch(`${server.url.origin}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })

  expect(capturedHeaders).not.toBeNull()
  expect(capturedHeaders!.get("x-initiator")).toBe("agent")
})
