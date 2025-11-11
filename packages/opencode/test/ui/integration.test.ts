import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Server } from "@/server/server"

import path from "path"

// Test configuration that includes the example plugin
const testConfig = JSON.stringify({
  model: "test/model",
  plugin: [`file://${path.join(process.cwd(), "examples/plugin-ui-demo/index.ts")}`]
})

describe("UI Plugin Integration", () => {
  let originalConfigContent: string | undefined

  beforeAll(() => {
    // Save original config and set test config
    originalConfigContent = process.env.OPENCODE_CONFIG_CONTENT
    process.env.OPENCODE_CONFIG_CONTENT = testConfig
  })

  afterAll(() => {
    // Restore original config
    if (originalConfigContent !== undefined) {
      process.env.OPENCODE_CONFIG_CONTENT = originalConfigContent
    } else {
      delete process.env.OPENCODE_CONFIG_CONTENT
    }
  })

  test("server /ui/extensions endpoint returns plugin data", async () => {
    // Get the server app instance
    const app = Server.App()

    // Make request to /ui/extensions endpoint
    const req = new Request("http://localhost/ui/extensions")
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const data = await res.json()

    // Should have our example plugin's extensions
    expect(data.widgets).toBeDefined()
    expect(data.panels).toBeDefined()
    expect(data.keybinds).toBeDefined()

    // Check for our specific plugin components
    const widget = data.widgets.find((w: any) => w.id === "example-counter-widget")
    expect(widget).toBeDefined()
    expect(widget?.label).toBe("Counter Widget")

    const panel = data.panels.find((p: any) => p.id === "example-info-panel")
    expect(panel).toBeDefined()
    expect(panel?.label).toBe("Example Info")

    console.log("Extensions:", JSON.stringify(data, null, 2))
  })

  test("server /ui/render/:componentId endpoint renders widget", async () => {
    // Get the server app instance
    const app = Server.App()

    // Make request to render widget
    const req = new Request("http://localhost/ui/render/example-counter-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          sessionID: "test-session-123",
          theme: "dark",
        },
      }),
    })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.content).toContain("Counter: 0")
    expect(data.content).toContain("Press Ctrl+Shift+I")
    expect(data.content).toContain("test-ses") // Should show first 8 chars of session ID
    expect(data.type).toBe("text")

    console.log("Rendered widget:", JSON.stringify(data, null, 2))
  })

  test("server /ui/render/:componentId endpoint renders panel", async () => {
    // Get the server app instance
    const app = Server.App()

    // Make request to render panel
    const req = new Request("http://localhost/ui/render/example-info-panel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          sessionID: "panel-test-456",
          theme: "light",
        },
      }),
    })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.content).toContain("=== Example Plugin Info ===")
    expect(data.content).toContain("Widget rendering")
    expect(data.content).toContain("Counter value: 0")
    expect(data.type).toBe("text")

    console.log("Rendered panel:", JSON.stringify(data, null, 2))
  })
})
