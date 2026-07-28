// @ts-nocheck
import { InputNav } from "./input-nav"
import type { UserMessage, Part } from "@opencode-ai/sdk/v2"

const mockMessages: UserMessage[] = [
  {
    id: "msg-1",
    sessionID: "session-1",
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-4" },
  },
  {
    id: "msg-2",
    sessionID: "session-1",
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-4" },
  },
  {
    id: "msg-3",
    sessionID: "session-1",
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-4" },
  },
]

const mockParts: Record<string, Part[]> = {
  "msg-1": [
    { id: "p1", sessionID: "session-1", messageID: "msg-1", type: "text", text: "Short" } as Part,
  ],
  "msg-2": [
    {
      id: "p2",
      sessionID: "session-1",
      messageID: "msg-2",
      type: "text",
      text: "This is a medium length message that contains more content than the first one but less than the third message in this conversation.",
    } as Part,
  ],
  "msg-3": [
    {
      id: "p3",
      sessionID: "session-1",
      messageID: "msg-3",
      type: "text",
      text: "This is a very long message with lots of detailed information about the task at hand. It contains multiple paragraphs and extensive context that the AI needs to understand in order to provide a helpful response. The width of the navigation bar should be proportional to this content length, making it visibly wider than the shorter messages above.",
    } as Part,
    { id: "p4", sessionID: "session-1", messageID: "msg-3", type: "file", mime: "image/png", filename: "screenshot.png", url: "https://via.placeholder.com/150" } as Part,
    { id: "p5", sessionID: "session-1", messageID: "msg-3", type: "file", mime: "application/pdf", filename: "document.pdf", url: "#" } as Part,
  ],
}

export default {
  title: "UI/InputNav",
  component: InputNav,
}

export const Basic = {
  args: {
    messages: mockMessages,
    getParts: (messageID: string) => mockParts[messageID] ?? [],
    current: mockMessages[1],
    onMessageSelect: (msg: UserMessage) => console.log("Selected:", msg.id),
  },
  decorators: [
    (Story: any) => (
      <div style={{ position: "relative", width: "400px", height: "300px", border: "1px solid #ccc", overflow: "hidden" }}>
        <div style={{ padding: "16px", color: "#666" }}>
          <p>Session content area</p>
          <p>Hover the bars on the right to see previews</p>
        </div>
        <Story />
      </div>
    ),
  ],
}

export const WithoutCurrent = {
  args: {
    messages: mockMessages,
    getParts: (messageID: string) => mockParts[messageID] ?? [],
    current: undefined,
    onMessageSelect: (msg: UserMessage) => console.log("Selected:", msg.id),
  },
  decorators: Basic.decorators,
}
