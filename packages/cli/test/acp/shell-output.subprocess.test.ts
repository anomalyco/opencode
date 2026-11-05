import type { PromptResponse, SessionNotification } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, expectOk, initialize, newSession, toolCallStream } from "./subprocess"

// Each line is printed seconds apart, so the live output is read before the command ends.
const command = "echo line 1; sleep 2; echo line 2; sleep 2; echo line 3"

// The first completion runs the command; the follow-up completion ends the turn.
function shellModel(request: unknown) {
  if (JSON.stringify(request).includes('"role":"tool"')) return "done"
  return toolCallStream("call_shell", "shell", { command })
}

describe("acp shell output subprocess", () => {
  test("streams a running shell command's output on in_progress tool call updates", async () => {
    await using fixture = await createAcpFixture({ respond: shellModel })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const result = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: `Run this and report the output: ${command}` }],
      }),
    )

    expect(result.stopReason).toBe("end_turn")
    const updates = acp
      .received()
      .filter((message) => message.method === "session/update")
      .map((message) => (message.params as SessionNotification).update)
      .filter((update) => update.sessionUpdate === "tool_call_update" && update.toolCallId === "call_shell")
    const running = updates.flatMap((update) => {
      if (update.sessionUpdate !== "tool_call_update" || update.status !== "in_progress") return []
      const part = update.content?.[0]
      return part?.type === "content" && part.content.type === "text" ? [part.content.text] : []
    })
    expect(running.some((text) => text.startsWith("line 1\n") && !text.includes("line 3"))).toBe(true)
    expect(running.every((text) => "line 1\nline 2\nline 3\n".startsWith(text))).toBe(true)
    expect(updates.at(-1)).toMatchObject({
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "line 1\nline 2\nline 3\n" } }],
    })
  }, 60_000)
})
