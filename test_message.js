import { createOpencodeClient } from "./packages/sdk/js/src/index.ts"

async function main() {
  const messageText = process.argv[2] || "Hello"
  const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })

  // 1. Create session
  const session = await client.session.create()
  const sessionId = session?.data?.id
  if (!sessionId) throw new Error("Session ID not found in response")

  // 2. Send message with explicit provider/model/mode (model only "gpt-4.1")
  const providerID = "github-copilot"
  const modelID = "gpt-4.1"
  const mode = "general"

  const message = await client.session.chat({
    path: { id: sessionId },
    body: {
      providerID,
      modelID,
      mode,
      parts: [{ type: "text", text: messageText }],
    },
  })
  // Only log concatenated text from all parts
  const parts = message?.data?.parts || []
  const reply = parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join(" ")
  console.log(reply)

  // 3. Delete session
  await client.session.delete({ path: { id: sessionId } })
}

main().catch(console.error)
