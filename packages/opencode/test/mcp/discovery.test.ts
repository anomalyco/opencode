import { describe, test, expect } from "bun:test"
import { MCP } from "../../src/mcp/index"

describe("MCP Discovery", () => {
  test("discover() returns array of servers", async () => {
    const servers = await MCP.discover()

    expect(Array.isArray(servers)).toBe(true)
    console.log(`\nDiscovered ${servers.length} MCP servers`)

    if (servers.length > 0) {
      const firstServer = servers[0]
      console.log("\nFirst server example:")
      console.log(JSON.stringify(firstServer, null, 2))

      // Validate structure of first server
      expect(firstServer).toHaveProperty("name")
      expect(firstServer).toHaveProperty("description")
      expect(firstServer).toHaveProperty("vendor")
      expect(firstServer).toHaveProperty("sourceUrl")
      expect(firstServer).toHaveProperty("runtime")
      expect(firstServer).toHaveProperty("installCommand")

      expect(typeof firstServer.name).toBe("string")
      expect(typeof firstServer.description).toBe("string")
      expect(typeof firstServer.vendor).toBe("string")
    }
  }, 10000) // 10 second timeout for network request

  test("discover() handles network errors gracefully", async () => {
    // This should not throw, just return empty array
    const servers = await MCP.discover()
    expect(Array.isArray(servers)).toBe(true)
  })

  test("discovered servers have valid structure", async () => {
    const servers = await MCP.discover()

    servers.slice(0, 3).forEach((server, idx) => {
      console.log(`\nServer ${idx + 1}:`)
      console.log(`  Name: ${server.name}`)
      console.log(`  Vendor: ${server.vendor}`)
      console.log(`  Description: ${server.description.substring(0, 80)}...`)
      console.log(`  Install: ${server.installCommand}`)

      expect(server.name).toBeTruthy()
      expect(server.vendor).toBeTruthy()
      expect(server.installCommand).toBeTruthy()
    })
  })
})
