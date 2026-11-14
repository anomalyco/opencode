/** @jsxImportSource @opentui/solid */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { EditorContextProvider } from "../src/context/editor"
import { TestTuiContexts } from "./fixture/tui-environment"

const ports = {
  CLAUDE_CODE_SSE_PORT: process.env.CLAUDE_CODE_SSE_PORT,
  OPENCODE_EDITOR_SSE_PORT: process.env.OPENCODE_EDITOR_SSE_PORT,
}

beforeEach(() => {
  delete process.env.CLAUDE_CODE_SSE_PORT
  delete process.env.OPENCODE_EDITOR_SSE_PORT
})

afterEach(() => {
  Object.entries(ports).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
})

test.each(["authenticated", "unauthenticated"])("sends IDE upgrade headers for an %s mcp connection", async (mode) => {
  const token = mode === "authenticated" ? "ide-test-token" : undefined
  const request = Promise.withResolvers<Headers>()
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      request.resolve(new Headers(req.headers))
      if (server.upgrade(req, { headers: { "Sec-WebSocket-Protocol": "mcp" } })) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      message() {},
    },
  })

  await using _app = await testRender(
    () => (
      <TestTuiContexts>
        <EditorContextProvider
          integration={{
            connection: () => ({ url: `ws://127.0.0.1:${server.port}`, authToken: token, source: "test" }),
          }}
        >
          {null}
        </EditorContextProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 4 },
  )

  const headers = await request.promise
  expect(headers.get("sec-websocket-protocol")).toBe("mcp")
  expect(headers.get("x-claude-code-ide-authorization")).toBe(token ?? null)
})
