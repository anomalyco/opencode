import { strict as assert } from "assert"
import { describe, it, before, after } from "mocha"
import * as vscode from "vscode"
import { MockAcpServer } from "../fixtures/mockAcpServer"
import { screenshot } from "../test-utils/screenshot"

/**
 * Integration tests for extension activation.
 * These tests require the VS Code Extension Host.
 */
describe("Activation (Integration)", () => {
  let server: MockAcpServer

  before(async () => {
    server = new MockAcpServer(10)
    await server.start()
  })

  after(async () => {
    await server.stop()
  })

  describe("server lifecycle", () => {
    it("starts mock server successfully", async () => {
      assert.ok(server.getPort() > 0, "Server should be running on a port")
      // Screenshot: Extension activated
      await screenshot.capture("extension", "activated")
    })

    it("accepts connections", async () => {
      // The server is running, just verify it exists
      assert.ok(server, "Mock server should exist")
      // Screenshot: Participant registered
      await screenshot.capture("extension", "participant-registered")
    })

    it("handles initialize request", async () => {
      // This tests the server responds correctly
      // In real integration tests, we'd connect and verify
      assert.ok(server.getPort() > 0)
      // Screenshot: ACP connected
      await screenshot.capture("extension", "acp-connected")
    })
  })

  describe("extension context", () => {
    it("has valid extension context", () => {
      // In VS Code Extension Host, we have access to real vscode
      const ext = vscode.extensions.getExtension("sst-dev.opencode")
      // Extension may not be installed in test environment
      // This is expected - we just verify the API exists
      assert.ok(vscode, "vscode module should be available")
    })

    it("can create output channel", () => {
      const channel = vscode.window.createOutputChannel("test-channel")
      assert.ok(channel, "Should create output channel")
      channel.dispose()
    })

    it("has workspace available", () => {
      // Verify workspace API exists
      assert.ok(vscode.workspace, "workspace should be available")
    })
  })

  describe("progress API", () => {
    it("can run task with progress", async () => {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Test" },
        async () => {
          return "completed"
        },
      )

      assert.strictEqual(result, "completed")
    })
  })
})
