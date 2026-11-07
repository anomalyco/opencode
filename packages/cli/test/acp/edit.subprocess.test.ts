import type { PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { createAcpFixture, expectOk, initialize, newSession, toolCallStream } from "./subprocess"

// Windows file names cannot contain a newline.
const testOutsideWindows = process.platform === "win32" ? test.skip : test

describe("acp edit subprocess", () => {
  testOutsideWindows(
    "completes an edit of a file whose name contains a newline (https://github.com/anomalyco/opencode/issues/54831)",
    async () => {
      const name = "notes.txt\nx"
      await using fixture = await createAcpFixture({
        respond: (request) => {
          if (lastMessage(request)?.role === "tool") return "done"
          return toolCallStream("call_edit", "edit", { path: name, oldString: "hello", newString: "world" })
        },
      })
      await Bun.write(path.join(fixture.home, name), "hello\n")
      const acp = fixture.spawn()
      await initialize(acp)
      const session = await newSession(acp, fixture.home)

      const response = await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "edit the file" }],
      })

      expect(response.error).toBeUndefined()
      expect(expectOk(response).stopReason).toBe("end_turn")
      expect(await Bun.file(path.join(fixture.home, name)).text()).toBe("world\n")
      expect(lastMessage(fixture.llm.requests.at(-1))).toMatchObject({ role: "tool", tool_call_id: "call_edit" })
    },
    60_000,
  )
})

function lastMessage(request: unknown) {
  return (request as { messages: { role: string }[] }).messages.at(-1)
}
