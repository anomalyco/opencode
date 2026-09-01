import assert from "node:assert/strict"
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createComputed, createRoot, createSignal } from "solid-js"

const seen: number[] = []
createRoot((dispose) => {
  const [value, setValue] = createSignal(0)
  createComputed(() => seen.push(value()))
  setValue(1)
  dispose()
})
assert.deepEqual(seen, [0, 1])

// Synthetic ConverseStream frames: message start, "hello", block stop, finish, usage.
const frames = [
  "AAAAVQAAADHED5/oDTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcADG1lc3NhZ2VTdGFydHsicm9sZSI6ImFzc2lzdGFudCJ9LAIB+A==",
  "AAAAdgAAADbcCl+fDTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcAEWNvbnRlbnRCbG9ja0RlbHRheyJjb250ZW50QmxvY2tJbmRleCI6MCwiZGVsdGEiOnsidGV4dCI6ImhlbGxvIn19HKeOCw==",
  "AAAAXAAAADXOcjmADTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcAEGNvbnRlbnRCbG9ja1N0b3B7ImNvbnRlbnRCbG9ja0luZGV4IjowfS4UYBU=",
  "AAAAWQAAADB2+EJ/DTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcAC21lc3NhZ2VTdG9weyJzdG9wUmVhc29uIjoiZW5kX3R1cm4ife9PAsc=",
  "AAAAkwAAAC22W97cDTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcACG1ldGFkYXRheyJ1c2FnZSI6eyJpbnB1dFRva2VucyI6MSwib3V0cHV0VG9rZW5zIjoxLCJ0b3RhbFRva2VucyI6Mn0sIm1ldHJpY3MiOnsibGF0ZW5jeU1zIjoxfX3Xmo3n",
]
const provider = createAmazonBedrock({
  region: "us-east-1",
  accessKeyId: "test",
  secretAccessKey: "test",
  fetch: Object.assign(
    async () =>
      new Response(Buffer.concat(frames.map((frame) => Buffer.from(frame, "base64"))), {
        headers: { "content-type": "application/vnd.amazon.eventstream" },
      }),
    { preconnect() {} },
  ),
})
const result = await provider("global.openai.gpt-5.6-luna").doStream({
  prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
})
const chunks = []
const reader = result.stream.getReader()
while (true) {
  const chunk = await reader.read()
  if (chunk.done) break
  chunks.push(chunk.value)
}
assert.deepEqual(
  chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta),
  ["hello"],
)
assert.ok(chunks.some((chunk) => chunk.type === "finish" && chunk.finishReason.unified === "stop"))
assert.ok(chunks.every((chunk) => chunk.type !== "error"))
console.log("Solid reactivity and Bedrock streaming passed")
