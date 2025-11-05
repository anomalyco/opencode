/**
 * Test: Verify context-panel plugin renders without "No renderer found" error
 * This simulates how the TUI loads and renders the plugin
 */

import { render } from "@opentui/solid"
import { ContextPanelPlugin } from "./examples/plugin-sidebar-context/index.tsx"

async function testPluginRender() {
  console.log("=== Testing Context Panel Plugin Render ===\n")

  // 1. Load the plugin
  console.log("1. Loading plugin...")
  const plugin = await ContextPanelPlugin()
  console.log("   ✓ Plugin loaded")

  // 2. Simulate ui.render call
  console.log("\n2. Calling ui.render...")
  const output: any = {}

  const mockClient = {
    sessions: {
      retrieve: async () => ({
        data: {
          context: {
            tokens: 1000,
            tokenLimit: 200000,
            system: 100,
            assistant: 500,
            user: 300,
            tool: 100,
            cost: 0.0015,
          },
        },
      }),
    },
  }

  await plugin["ui.render"](
    {
      componentId: "context-panel",
      context: {
        client: mockClient,
        sessionID: "test-session-123",
      },
    },
    output,
  )

  if (!output.component) {
    console.error("   ✗ No component returned!")
    process.exit(1)
  }
  console.log("   ✓ Component function returned")

  // 3. Try to render the component
  console.log("\n3. Rendering component...")
  try {
    const Component = output.component

    // Render in a test container
    const result = render(() => <Component />, document.createElement("div"))

    console.log("   ✓ Component rendered successfully!")
    console.log("\n=== TEST PASSED ===")
    console.log("The plugin should work in the TUI now.")

    // Cleanup
    if (typeof result === "function") result()
  } catch (err) {
    console.error("   ✗ Render failed:", err)
    console.error("\nError details:", err instanceof Error ? err.stack : String(err))
    process.exit(1)
  }
}

testPluginRender().catch((err) => {
  console.error("Test failed:", err)
  process.exit(1)
})
