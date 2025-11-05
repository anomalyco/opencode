/**
 * Diagnostic: Check what happens when we load the plugins
 */

console.log("=== Plugin Load Diagnostic ===\n")

// Test 1: Load context plugin
console.log("1. Loading context-panel plugin...")
try {
  const contextPlugin = await import("./examples/plugin-sidebar-context/index.tsx")
  console.log("   ✓ Module loaded")
  console.log("   Exports:", Object.keys(contextPlugin))

  const plugin = await contextPlugin.ContextPanelPlugin()
  console.log("   ✓ Plugin initialized")
  console.log("   Hooks:", Object.keys(plugin))

  // Test ui.render
  const output: any = {}
  await plugin["ui.render"](
    {
      componentId: "context-panel",
      context: { client: {}, sessionID: "test" },
    },
    output,
  )

  console.log("   ✓ ui.render called")
  console.log("   Output type:", output.type)
  console.log("   Output component:", typeof output.component)

  // Try to inspect the component function
  if (output.component) {
    console.log("   Component function source (first 200 chars):")
    console.log("   ", output.component.toString().substring(0, 200))
  }
} catch (err) {
  console.error("   ✗ Error:", err)
  if (err instanceof Error) {
    console.error("   Stack:", err.stack)
  }
}

console.log("\n2. Loading sidebar-tabs plugin...")
try {
  const tabsPlugin = await import("./examples/plugin-sidebar-tabs/index.tsx")
  console.log("   ✓ Module loaded")
  console.log("   Exports:", Object.keys(tabsPlugin))

  const plugin = await tabsPlugin.SidebarTabsPlugin()
  console.log("   ✓ Plugin initialized")
  console.log("   Hooks:", Object.keys(plugin))
} catch (err) {
  console.error("   ✗ Error:", err)
  if (err instanceof Error) {
    console.error("   Stack:", err.stack)
  }
}

console.log("\n=== Diagnostic Complete ===")
