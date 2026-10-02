import type { NewSessionResponse, PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { createAcpFixture, expectOk, initialize } from "./subprocess"

// The first completion reads the file outside cwd; the follow-up completion ends the turn.
function readingModel(file: () => string) {
  return (request: unknown) => {
    if (JSON.stringify(request).includes('"role":"tool"')) return "done"
    return new Response(toolCall(file()), { headers: { "content-type": "text/event-stream" } })
  }
}

function toolCall(file: string) {
  const call = { index: 0, id: "call_read", type: "function", function: { name: "read", arguments: "" } }
  const chunks = [
    { choices: [{ delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }], usage: null },
    {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: file }) } }] } }],
      usage: null,
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: null },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } },
  ]
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`
}

describe("acp additional directories subprocess", () => {
  test("tools read files in an additional directory without an external directory ask", async () => {
    const target = { file: "" }
    await using fixture = await createAcpFixture({ respond: readingModel(() => target.file) })
    // Keep the unresolved tmpdir spelling, which differs from the real path on macOS.
    const shared = path.join(fixture.root, "shared")
    target.file = path.join(shared, "notes.txt")
    await fs.mkdir(shared)
    await Bun.write(target.file, "shared root content\n")
    const acp = fixture.spawn()
    await initialize(acp)
    const session = expectOk(
      await acp.request<NewSessionResponse>("session/new", {
        cwd: fixture.home,
        additionalDirectories: [shared],
        mcpServers: [],
      }),
    )

    const result = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "read the shared notes" }],
      }),
    )

    expect(result.stopReason).toBe("end_turn")
    expect(JSON.stringify(fixture.llm.requests.at(-1))).toContain("shared root content")
  }, 60_000)
})
