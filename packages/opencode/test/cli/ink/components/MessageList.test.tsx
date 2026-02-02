/** @jsxImportSource react */
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { MessageList } from "@/cli/ink/components/MessageList"
import type { Message } from "@/cli/ink/state/types"

describe("MessageList", () => {
  const messages: Message[] = [
    { id: "msg-1", role: "user", parts: [{ type: "text", content: "Hello" }], complete: true },
    { id: "msg-2", role: "assistant", parts: [{ type: "text", content: "Hi there" }], complete: true },
  ]

  it("renders without errors", () => {
    const { lastFrame } = render(<MessageList messages={messages} />)
    lastFrame()
  })

  it("renders empty list without error", () => {
    const { lastFrame } = render(<MessageList messages={[]} />)
    lastFrame()
  })

  it("renders with multiple message parts", () => {
    const multiPartMessages: Message[] = [
      {
        id: "msg-1",
        role: "user",
        parts: [
          { type: "text", content: "First part" },
          { type: "text", content: "Second part" },
        ],
        complete: true,
      },
    ]
    const { lastFrame } = render(<MessageList messages={multiPartMessages} />)
    lastFrame()
  })
})
