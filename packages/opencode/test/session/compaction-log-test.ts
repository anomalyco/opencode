import { SessionCompaction } from "../../src/session/compaction"
import type { Provider } from "../../src/provider/provider"
import type { ModelMessage } from "ai"
import { Log } from "../../src/util/log"
import type { MessageV2 } from "../../src/session/message-v2"

// Enable log printing so we can see output
Log.init({ print: true })

function createModel(context: number, output: number): Provider.Model {
  return {
    id: "kiro/claude-opus-4-6",
    providerID: "kiro",
    name: "Kiro",
    limit: { context, output },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

function textForTokens(n: number) {
  return "x".repeat(n * 4)
}
function userMsg(tokens: number): ModelMessage {
  return { role: "user", content: [{ type: "text", text: textForTokens(tokens) }] }
}
function assistantMsg(tokens: number): ModelMessage {
  return { role: "assistant", content: [{ type: "text", text: textForTokens(tokens) }] }
}

function usage(total: number): MessageV2.Assistant["tokens"] {
  return {
    input: total,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
    total,
  }
}

const model = createModel(180_000, 16_000)

// Scenario 1: 170K usage (should trigger overflow)
console.log("\n=== Scenario 1: 170K usage tokens ===")
const msgs1: ModelMessage[] = []
for (let i = 0; i < 15; i++) {
  msgs1.push(userMsg(5_000))
  msgs1.push(assistantMsg(5_000))
}
const result1 = await SessionCompaction.isOverflow({ tokens: usage(170_000), model })
console.log(`isOverflow: ${result1}\n`)

// Scenario 2: 80K usage (should NOT trigger)
console.log("=== Scenario 2: 80K usage tokens ===")
const msgs2: ModelMessage[] = []
for (let i = 0; i < 8; i++) {
  msgs2.push(userMsg(5_000))
  msgs2.push(assistantMsg(5_000))
}
const result2 = await SessionCompaction.isOverflow({ tokens: usage(80_000), model })
console.log(`isOverflow: ${result2}\n`)

// Scenario 3: tool output truncation
console.log("=== Scenario 3: truncate tool outputs ===")
const tool: ModelMessage = {
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: "tool-call-1",
      toolName: "search",
      output: { type: "text", value: "y".repeat(8_000) },
    },
  ],
}
const truncated = SessionCompaction.truncateModelMessages([tool])
const compacted = JSON.stringify(truncated).includes("Content truncated for compaction")
console.log(`Contains truncation marker: ${compacted}\n`)
