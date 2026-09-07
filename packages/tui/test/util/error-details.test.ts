import { expect, test } from "bun:test"
import { errorDetails } from "../../src/util/error-details"

test("copy and investigation include the plugin context and matching log reference", () => {
  const result = errorDetails({
    title: "Server plugin: example",
    error: "Plugin failed to load",
    context: "Status: failed\nRuntime: server\nSource: /project/plugin.ts",
    diagnosticRef: "err_a1b2c3d4",
  })
  expect(result.text).toBe(
    "Server plugin: example\nStatus: failed\nRuntime: server\nSource: /project/plugin.ts\nError: Plugin failed to load\nReference: err_a1b2c3d4",
  )
  expect(result.prompt).toContain(result.text)
  expect(result.prompt).toContain("Find the server log entry matching reference err_a1b2c3d4")
  expect(result.prompt).toContain("If the server logs are not accessible")
  expect(result.prompt).toContain("Do not expose credentials.")
})

test("errors without a reference still have useful copy and investigation text", () => {
  const result = errorDetails({ title: "MCP server: example", error: "Connection refused" })
  expect(result.text).toBe("MCP server: example\nError: Connection refused")
  expect(result.prompt).toContain(result.text)
  expect(result.prompt).not.toContain("matching reference")
  expect(result.text).not.toContain("undefined")
})
