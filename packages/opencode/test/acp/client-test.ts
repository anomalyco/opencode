/**
 * Test: ACP Client
 *
 * This test demonstrates the full ACP client flow:
 * 1. Create client and connect to claude-code-acp
 * 2. Initialize the connection
 * 3. Create a session
 * 4. Send a prompt
 * 5. Receive and display responses
 *
 * Run with: bun test/acp/client-test.ts
 */

import { ACPClient } from "../../src/acp/client"
import type { SessionNotification } from "@agentclientprotocol/sdk"

async function main() {
  console.log("=== ACP Client Test ===\n")

  // Track received messages
  const messages: string[] = []

  // Create the client
  console.log("Creating ACP client...")
  const client = await ACPClient.create({
    command: "claude-code-acp", // Make sure this is in your PATH
    cwd: process.cwd(),
    onSessionUpdate: (update: SessionNotification) => {
      // Handle different types of session updates
      switch (update.update.sessionUpdate) {
        case "agent_message_chunk":
          if (update.update.content.type === "text") {
            process.stdout.write(update.update.content.text)
            messages.push(update.update.content.text)
          }
          break

        case "agent_thought_chunk":
          if (update.update.content.type === "text") {
            console.log(`[Thinking] ${update.update.content.text}`)
          }
          break

        case "tool_call":
          console.log(`\n[Tool] ${update.update.title} (${update.update.status})`)
          break

        case "tool_call_update":
          console.log(`[Tool Update] ${update.update.status}`)
          break

        default:
          console.log(`[Update] ${update.update.sessionUpdate}`)
      }
    },
  })

  console.log("✓ Client created\n")

  try {
    // 1. Initialize
    console.log("Initializing connection...")
    const initResponse = await client.initialize()
    console.log(`✓ Initialized with ${initResponse.agentInfo?.name} v${initResponse.agentInfo?.version}`)
    console.log(`  Protocol version: ${initResponse.protocolVersion}`)

    // Display available auth methods
    const authMethods = client.getAuthMethods()
    if (authMethods.length > 0) {
      console.log(`  Auth methods available: ${authMethods.length}`)
      authMethods.forEach((method) => {
        console.log(`    - ${method.name} (${method.id})`)
        if (method.description) {
          console.log(`      ${method.description}`)
        }
      })
    } else {
      console.log(`  No authentication required`)
    }
    console.log()

    // 2. Create session
    console.log("Creating session...")
    const sessionResponse = await client.createSession()
    console.log(`✓ Session created: ${sessionResponse.sessionId}`)
    console.log(`  Current model: ${sessionResponse.models?.currentModelId}\n`)

    // 3. Send prompt
    console.log("Sending prompt...\n")
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    const prompt = "Hello! What is 2 + 2? Please give a brief answer."
    console.log(`User: ${prompt}\n`)
    console.log("Assistant: ")

    const promptResponse = await client.sendPrompt(sessionResponse.sessionId, prompt)

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    console.log(`\n✓ Prompt completed with stop reason: ${promptResponse.stopReason}`)
    console.log(`\nFull response: "${messages.join("")}"`)
  } finally {
    // Cleanup
    console.log("\nCleaning up...")
    await client.dispose()
    console.log("✓ Client disposed\n")
  }

  console.log("=== Test Complete ===")
}

// Only run if this file is executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("\n❌ Fatal error:", error)
    process.exit(1)
  })
}
