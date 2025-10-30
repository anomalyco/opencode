#!/usr/bin/env bun

/**
 * Comprehensive MCP Server Testing Suite
 * Consolidates all MCP server tests into a single, production-ready test suite
 * Tests both local and remote servers with proper timeouts and detailed reporting
 */

import { experimental_createMCPClient } from "ai"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const TEST_TIMEOUT = 30000 // 30 seconds per test

interface TestResult {
  server: string
  type: "local" | "remote"
  transport?: string
  passed: boolean
  toolCount: number
  tools: string[]
  error?: string
}

const results: TestResult[] = []

async function testLocalServer(name: string, command: string[], env?: Record<string, string>): Promise<TestResult> {
  console.log(`\n📦 Testing local MCP server: ${name}`)
  console.log(`   Command: ${command.join(" ")}`)

  const result: TestResult = {
    server: name,
    type: "local",
    passed: false,
    toolCount: 0,
    tools: [],
  }

  try {
    const [cmd, ...args] = command
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout after 30s")), TEST_TIMEOUT),
    )

    const client = await Promise.race([
      experimental_createMCPClient({
        name: "opencode-test",
        transport: new StdioClientTransport({
          command: cmd,
          args,
          env: Object.fromEntries(
            Object.entries({ ...process.env, ...env }).filter(([_, v]) => v !== undefined),
          ) as Record<string, string>,
        }),
      }),
      timeoutPromise,
    ])

    const tools = await Promise.race([client.tools(), timeoutPromise])
    const toolNames = Object.keys(tools)

    result.passed = toolNames.length > 0
    result.toolCount = toolNames.length
    result.tools = toolNames

    console.log(`   ✅ Connected successfully`)
    console.log(
      `   Tools: ${toolNames.length} - ${toolNames.slice(0, 5).join(", ")}${toolNames.length > 5 ? "..." : ""}`,
    )

    client.close()
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    console.log(`   ❌ Failed: ${result.error}`)
  }

  return result
}

async function testRemoteServer(name: string, url: string, headers?: Record<string, string>): Promise<TestResult> {
  console.log(`\n🌐 Testing remote MCP server: ${name}`)
  console.log(`   URL: ${url}`)

  const transports = [
    {
      name: "StreamableHTTP",
      transport: new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers },
      }),
    },
    {
      name: "SSE",
      transport: new SSEClientTransport(new URL(url), {
        requestInit: { headers },
      }),
    },
  ]

  for (const { name: transportName, transport } of transports) {
    console.log(`   Trying ${transportName} transport...`)

    const result: TestResult = {
      server: name,
      type: "remote",
      transport: transportName,
      passed: false,
      toolCount: 0,
      tools: [],
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout after 30s")), TEST_TIMEOUT),
      )

      const client = await Promise.race([
        experimental_createMCPClient({
          name: "opencode-test",
          transport,
        }),
        timeoutPromise,
      ])

      const tools = await Promise.race([client.tools(), timeoutPromise])
      const toolNames = Object.keys(tools)

      result.passed = toolNames.length > 0
      result.toolCount = toolNames.length
      result.tools = toolNames

      console.log(`   ✅ Connected successfully via ${transportName}`)
      console.log(
        `   Tools: ${toolNames.length} - ${toolNames.slice(0, 5).join(", ")}${toolNames.length > 5 ? "..." : ""}`,
      )

      client.close()
      results.push(result)
      return result
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.log(`   ⚠️  ${transportName} failed: ${errorMsg}`)
      result.error = errorMsg
    }
  }

  // If we get here, all transports failed
  const failedResult: TestResult = {
    server: name,
    type: "remote",
    passed: false,
    toolCount: 0,
    tools: [],
    error: "All transports failed",
  }
  results.push(failedResult)
  console.log(`   ❌ All transports failed`)
  return failedResult
}

async function main() {
  console.log("🧪 Comprehensive MCP Server Testing Suite")
  console.log("=".repeat(60))

  // Test local servers
  console.log("\n📦 Local MCP Servers")

  results.push(await testLocalServer("everything", ["npx", "-y", "@modelcontextprotocol/server-everything"]))

  results.push(await testLocalServer("filesystem", ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]))

  results.push(await testLocalServer("memory", ["npx", "-y", "@modelcontextprotocol/server-memory"]))

  results.push(
    await testLocalServer("sequential-thinking", ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"]),
  )

  results.push(await testLocalServer("puppeteer", ["npx", "-y", "@modelcontextprotocol/server-puppeteer"]))

  // Test Python-based servers (if uvx is available)
  console.log("\n🐍 Python-based MCP Servers")

  try {
    // Check if uvx is available
    await Bun.which("uvx")
    console.log("   uvx found, testing Python servers...")

    results.push(await testLocalServer("time", ["uvx", "mcp-server-time"]))

    results.push(await testLocalServer("git", ["uvx", "mcp-server-git", "--repository", process.cwd()]))
  } catch {
    console.log("   ⚠️  uvx not found, skipping Python servers (install with: pip install uvx)")
  }

  // Test remote servers
  console.log("\n🌐 Remote MCP Servers")

  await testRemoteServer("context7", "https://mcp.context7.com/mcp")

  await testRemoteServer("gh_grep", "https://mcp.grep.app")

  // Summary
  console.log("\n" + "=".repeat(60))
  console.log("📊 Comprehensive Test Summary")
  console.log("=".repeat(60))

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length

  console.log(`\n✅ Passed: ${passed}/${results.length}`)
  console.log(`❌ Failed: ${failed}/${results.length}`)

  if (failed > 0) {
    console.log("\n❌ Failed servers:")
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`   - ${r.server} (${r.type}${r.transport ? `/${r.transport}` : ""}): ${r.error}`)
      })
  }

  console.log("\n✅ Successful servers:")
  results
    .filter((r) => r.passed)
    .forEach((r) => {
      console.log(`   - ${r.server} (${r.type}${r.transport ? `/${r.transport}` : ""}): ${r.toolCount} tools`)
    })

  // Generate config file for successful servers
  console.log("\n📝 Generating config for successful servers...")
  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {} as Record<string, any>,
  }

  results
    .filter((r) => r.passed)
    .forEach((r) => {
      if (r.type === "local") {
        const commands: Record<string, string[]> = {
          everything: ["npx", "-y", "@modelcontextprotocol/server-everything"],
          filesystem: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          memory: ["npx", "-y", "@modelcontextprotocol/server-memory"],
          "sequential-thinking": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
          puppeteer: ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
          time: ["uvx", "mcp-server-time"],
          git: ["uvx", "mcp-server-git", "--repository", "."],
        }

        config.mcp[r.server] = {
          type: "local",
          command: commands[r.server] || [],
        }
      } else {
        config.mcp[r.server] = {
          type: "remote",
          url: r.server === "context7" ? "https://mcp.context7.com/mcp" : "https://mcp.grep.app",
        }
      }
    })

  await Bun.write("./test-mcp-comprehensive-results.json", JSON.stringify(results, null, 2))
  await Bun.write("./test-mcp-comprehensive-config.jsonc", JSON.stringify(config, null, 2))

  console.log("✅ Results written to test-mcp-comprehensive-results.json")
  console.log("✅ Config written to test-mcp-comprehensive-config.jsonc")

  // Exit with error if any tests failed
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error("💥 Fatal error:", error)
  process.exit(1)
})
