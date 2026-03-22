#!/usr/bin/env bun
/**
 * OpenCode Async Chat - Uses promptAsync + SSE/polling for faster interaction
 */
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
  console.error("Usage: bun run async_chat.ts --PROMPT 'question' [--SESSION_ID id] [--PORT port]")
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
      console.error(`Created session: ${sid}`)
    }

    // Send prompt async
    const asyncResp = await client.session.promptAsync({
      path: { id: sid },
      body: {
        parts: [{ type: "text", text: input }],
      },
    })

    // Poll for completion via SSE events
    const eventsUrl = `http://127.0.0.1:${port}/session/${sid}/event`
    console.error(`Waiting for response... (events: ${eventsUrl})`)

    // Poll messages until we get the assistant response
    let attempts = 0
    const maxAttempts = 120 // 2 minutes with 1s intervals

    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000))
      attempts++

      try {
        // Get session messages to check for completion
        const messagesResp = await client.session.messages({
          path: { id: sid },
        })

        const messages = messagesResp.data || []
        // Find the last assistant message
        const lastAssistant = [...messages].reverse().find((msg: any) => msg?.info?.role === "assistant")

        if (lastAssistant?.info?.role === "assistant" && lastAssistant.info.time?.completed) {
          const textParts = (lastAssistant.parts || []).filter((p: any) => p.type === "text")
          const text = textParts.map((p: any) => p.text).join("\n")

          console.log(
            JSON.stringify(
              {
                success: true,
                session_id: sid,
                model: lastAssistant.info.modelID,
                response: text,
              },
              null,
              2,
            ),
          )
          return
        }
      } catch (e) {
        // messages endpoint might not exist, try getting session info
      }
    }

    console.log(
      JSON.stringify(
        {
          success: false,
          session_id: sid,
          error: "Timeout waiting for response",
        },
        null,
        2,
      ),
    )
    process.exit(1)
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
