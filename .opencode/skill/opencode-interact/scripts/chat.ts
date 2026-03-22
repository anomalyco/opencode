#!/usr/bin/env bun
/**
 * OpenCode Chat via direct HTTP API
 */

const args = process.argv.slice(2)
const promptIdx = args.indexOf("--PROMPT")
const sessionIdx = args.indexOf("--SESSION_ID")
const portIdx = args.indexOf("--PORT")
const portArg = portIdx >= 0 ? args[portIdx + 1] : undefined

const prompt = promptIdx >= 0 ? args[promptIdx + 1] : null
const existingSessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : null
const port = portArg ? parseInt(portArg, 10) : 4098
const BASE = `http://127.0.0.1:${port}`

if (!prompt) {
  console.error("Usage: bun run chat.ts --PROMPT 'question' [--SESSION_ID id] [--PORT port]")
  process.exit(1)
}

async function main() {
  // 1. Create or reuse session
  let sessionId = existingSessionId
  if (!sessionId) {
    const createResp = await fetch(`${BASE}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const sessionData = (await createResp.json()) as any
    sessionId = sessionData.id
    console.error(`Session created: ${sessionId}`)
  }

  // 2. Send prompt async
  const asyncResp = await fetch(`${BASE}/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parts: [{ type: "text", text: prompt }],
    }),
  })
  console.error(`Prompt sent to session: ${sessionId}`)

  // 3. Poll for the assistant response using SSE or messages
  let attempts = 0
  const maxAttempts = 180 // 3 minutes

  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 1000))
    attempts++

    try {
      const ctrl = new AbortController()
      setTimeout(() => ctrl.abort(), 5000)

      const msgResp = await fetch(`${BASE}/session/${sessionId}/message`, {
        signal: ctrl.signal,
      })

      if (msgResp.ok) {
        const msgs = (await msgResp.json()) as any[]
        const msgData = [...msgs].reverse().find((msg: any) => msg?.info?.role === "assistant")
        if (msgData?.info?.time?.completed) {
          const textParts = (msgData.parts || []).filter((p: any) => p.type === "text")
          const text = textParts.map((p: any) => p.text).join("\n")
          console.log(
            JSON.stringify(
              {
                success: true,
                session_id: sessionId,
                message_id: msgData.info.id,
                model: msgData.info.modelID,
                response: text,
              },
              null,
              2,
            ),
          )
          return
        }
      }
    } catch {
      // retry
    }
  }

  console.log(
    JSON.stringify(
      {
        success: false,
        session_id: sessionId,
        error: "Timeout waiting for response",
      },
      null,
      2,
    ),
  )
  process.exit(1)
}

main().catch((e) => {
  console.log(JSON.stringify({ success: false, error: e.message }, null, 2))
  process.exit(1)
})
