import { describe, expect, it } from "bun:test"
import { makeToolCallRepair } from "@/session/llm"

const tools = { bash: {}, edit: {} } as unknown as Parameters<typeof makeToolCallRepair>[0]

function repairInput(toolCall: Record<string, unknown>, message: string) {
  return {
    system: undefined,
    messages: [],
    tools: tools as never,
    inputSchema: () => ({}) as never,
    toolCall: toolCall as never,
    error: { message } as never,
  }
}

describe("session.llm.makeToolCallRepair", () => {
  it("synthesizes a toolCallId when the model emitted an empty one", async () => {
    const repair = makeToolCallRepair(tools)
    const repaired = await repair(
      repairInput({ toolCallId: "", toolName: "", input: "" }, "Model tried to call unavailable tool ''."),
    )

    expect(repaired).not.toBeNull()
    expect(repaired!.toolName).toBe("invalid")
    expect(repaired!.toolCallId.startsWith("call_")).toBe(true)
    expect(repaired!.toolCallId.length).toBeGreaterThan(10)
  })

  it("keeps an existing non-empty toolCallId", async () => {
    const repair = makeToolCallRepair(tools)
    const repaired = await repair(repairInput({ toolCallId: "call_existing", toolName: "Bash", input: "{}" }, "No such tool capacity."))

    expect(repaired).not.toBeNull()
    expect(repaired!.toolCallId).toBe("call_existing")
    expect(repaired!.toolName).toBe("bash")
  })
})
