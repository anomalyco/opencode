import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { UIRegistry } from "../../src/ui/registry"

import path from "path"

// Test configuration that includes the example plugin
const testConfig = JSON.stringify({
  model: "test/model",
  plugin: [`file://${path.join(process.cwd(), "examples/plugin-ui-demo/index.ts")}`]
})

describe("UI Plugin System", () => {
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

  test("should load plugins and register UI extensions", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        // Initialize plugins
        await Plugin.init()

        // Get registered widgets
        const widgets = await UIRegistry.getWidgets()
        console.log(
          `Found ${widgets.length} widgets:`,
          widgets.map((w) => w.id),
        )

        // Get registered panels
        const panels = await UIRegistry.getPanels()
        console.log(
          `Found ${panels.length} panels:`,
          panels.map((p) => p.id),
        )

        // Get registered keybinds
        const keybinds = await UIRegistry.getKeybinds()
        console.log(
          `Found ${keybinds.length} keybinds:`,
          keybinds.map((k) => k.keys),
        )

        // Verify example plugin loaded
        const exampleWidget = widgets.find((w) => w.id === "example-counter-widget")
        expect(exampleWidget).toBeDefined()
        expect(exampleWidget?.label).toBe("Counter Widget")

        const examplePanel = panels.find((p) => p.id === "example-info-panel")
        expect(examplePanel).toBeDefined()
        expect(examplePanel?.label).toBe("Example Info")

        const exampleKeybind = keybinds.find((k) => k.id === "example-increment")
        expect(exampleKeybind).toBeDefined()
        expect(exampleKeybind?.keys).toBe("ctrl+shift+i")
      },
    })
  })

  test("should render plugin components", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        await Plugin.init()

        // Render the counter widget
        const result = await UIRegistry.renderComponent("example-counter-widget", {
          sessionID: "test-session-123",
          theme: "dark",
        })

        console.log("Rendered content:", result)

        expect(result.content).toBeDefined()
        expect(result.type).toBe("text")
        expect(result.content).toContain("Counter:")
        expect(result.content).toContain("test-ses")
      },
    })
  })

  test("should render panel content", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        await Plugin.init()

        // Render the info panel
        const result = await UIRegistry.renderComponent("example-info-panel", {
          sessionID: "test-panel-session",
        })

        console.log("Panel content:", result)

        expect(result.content).toBeDefined()
        expect(result.type).toBe("text")
        expect(result.content).toContain("Example Plugin Info")
        expect(result.content).toContain("Widget rendering")
        expect(result.content).toContain("Counter value: 0")
      },
    })
  })

  test("should render status item", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        await Plugin.init()

        // Render the status item
        const result = await UIRegistry.renderComponent("example-status", {})

        console.log("Status item:", result)

        expect(result.content).toBeDefined()
        expect(result.type).toBe("text")
        expect(result.content).toContain("Counter:")
      },
    })
  })

  test("server /ui/extensions endpoint works", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const { Server } = await import("../../src/server/server")
        const app = Server.App()

        // Test /ui/extensions endpoint
        const req = new Request("http://localhost:4096/ui/extensions")
        const res = await app.fetch(req)

        expect(res.status).toBe(200)

        const data: any = await res.json()
        console.log("Server extensions response:", data)

        expect(data.widgets).toBeDefined()
        expect(data.panels).toBeDefined()
        expect(data.keybinds).toBeDefined()
        expect(data.statusItems).toBeDefined()
        expect(data.commands).toBeDefined()

        // Should have at least one widget with our example
        expect(data.widgets.length).toBeGreaterThanOrEqual(1)
        const exampleWidget = data.widgets.find((w: any) => w.id === "example-counter-widget")
        expect(exampleWidget).toBeDefined()
        expect(exampleWidget?.label).toBe("Counter Widget")

        // Should have at least one panel with our example
        expect(data.panels.length).toBeGreaterThanOrEqual(1)
        const examplePanel = data.panels.find((p: any) => p.id === "example-info-panel")
        expect(examplePanel).toBeDefined()
        expect(examplePanel?.label).toBe("Example Info")
      },
    })
  })
})
