#!/usr/bin/env bun
import { createOpencodeClient } from "@opencode-ai/sdk"

const args = process.argv.slice(2)
const promptIdx = args.indexOf("--PROMPT")
const sessionIdx = args.indexOf("--SESSION_ID")
const portIdx = args.indexOf("--PORT")
const portArg = portIdx >= 0 ? args[portIdx + 1] : undefined

const prompt = promptIdx >= 0 ? args[promptIdx + 1] : null
const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : null
const port = portArg ? parseInt(portArg, 10) : 49529

if (!prompt) {
  console.error("Usage: bun run quick_chat.ts --PROMPT 'question' [--SESSION_ID id] [--PORT port]")
  process.exit(1)
}

const input = prompt

const client = createOpencodeClient({
  baseUrl: `http://127.0.0.1:${port}`,
})

async function main() {
  try {
    // Create or reuse session
    let sid = sessionId
    if (!sid) {
      const sessionResponse = await client.session.create()
      if (!sessionResponse.data) throw new Error("Session creation returned no data")
      sid = sessionResponse.data.id
    }

    // Send prompt
    const response = await client.session.prompt({
      path: { id: sid },
      body: {
        parts: [{ type: "text", text: input }],
      },
    })

    if (!response.data) throw new Error("Prompt response returned no data")
    const { info, parts } = response.data
    const textParts = parts.filter((p: any) => p.type === "text")
    const output = textParts.map((p: any) => p.text).join("\n")

    console.log(
      JSON.stringify(
        {
          success: true,
          session_id: sid,
          model: info.modelID,
          response: output,
        },
        null,
        2,
      ),
    )
  } catch (error: any) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: error.message || String(error),
        },
        null,
        2,
      ),
    )
    process.exit(1)
  }
}

main()
