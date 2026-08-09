import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

function firstText(content: unknown): string {
  const item = (content as Array<{ type: string; text?: string }>)[0]
  if (!item || item.type !== "text" || typeof item.text !== "string") throw new Error("Expected text content")
  return item.text
}

const testMcpServer = async () => {
  const transport = new StdioClientTransport({
    command: "bun",
    args: [
      "run",
      "src/index.ts",
      "mcp-server",
      "--transport",
      "stdio",
    ],
    cwd: process.cwd(),
  })

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} },
  )

  try {
    await client.connect(transport)
    console.log("✓ Connected to MCP server")

    const toolsResult = await client.listTools()
    console.log(`✓ Listed ${toolsResult.tools.length} tools:`, toolsResult.tools.map((t) => t.name).join(", "))

    const createResult = await client.callTool({ name: "create_session", arguments: {} })
    const createText = firstText(createResult.content)
    console.log("✓ create_session:", createText)

    const sessionId = JSON.parse(createText).session_id
    console.log(`   Session ID: ${sessionId}`)

    const promptResult = await client.callTool({
      name: "prompt",
      arguments: {
        session_id: sessionId,
        message: "What is the current directory structure?",
      },
    })
    console.log("✓ prompt response (truncated):", firstText(promptResult.content).slice(0, 200) + "...")

    const listResult = await client.callTool({ name: "list_sessions", arguments: {} })
    console.log("✓ list_sessions:", firstText(listResult.content))

    console.log("\n✅ All MCP server tests passed!")
  } catch (error) {
    console.error("❌ Test failed:", error)
    process.exit(1)
  } finally {
    await client.close()
  }
}

testMcpServer()
