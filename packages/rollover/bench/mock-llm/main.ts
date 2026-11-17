#!/usr/bin/env bun
// Standalone mock-llm runner for spike/bench use.
// Usage: bun run bench/mock-llm/main.ts [--port 4545] [--log <dir>]
import { startMockLlm, type MockScript } from "./server"

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const port = arg("--port") ? Number(arg("--port")) : 4545

// Scripted demo flows for the spike (matched by substring, in order).
// The extraction/consolidation entries MUST come first: their markers appear in
// every generate.text prompt of that purpose, and extraction calls share the
// conversational delta text, so earlier-placed conversational entries would
// otherwise win the match (candidates are scanned in script order).
const script: MockScript = [
  { match: "You maintain a durable memory ledger", content: '{"records":[]}' },
  { match: "You clean a memory ledger", content: '{"invalidate":[]}' },
  { match: "Read the file", content: "", usage: { input: 1200, output: 20, cacheRead: 500, cacheWrite: 300 },
    toolCalls: [{ id: "call_read_1", name: "read", args: '{"path":"./sample.txt"}' }] },
  { match: "sample.txt", content: "I read sample.txt; it contains: alpha line, beta line.", usage: { input: 2400, output: 40, cacheRead: 900, cacheWrite: 0 } },
  { match: "Start a shell command", content: "Starting the background command now.", usage: { input: 1500, output: 25 },
    toolCalls: [{ id: "call_shell_bg", name: "shell", args: '{"command":"sleep 3 && echo done","background":true}' }] },
]

const llm = await startMockLlm({ port, script, logDir: arg("--log") })
console.log(`mock-llm listening on ${llm.url}`)
process.on("SIGTERM", async () => {
  await llm.stop()
  process.exit(0)
})
process.on("SIGINT", async () => {
  await llm.stop()
  process.exit(0)
})
