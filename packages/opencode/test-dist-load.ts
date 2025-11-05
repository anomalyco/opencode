/**
 * Test loading the dist JS files
 */

console.log("=== Testing Dist File Loading ===\n")

console.log("1. Loading sidebar-tabs from dist...")
const tabsModule = await import("./examples/plugin-sidebar-tabs/dist/index.js")
console.log("   Exports:", Object.keys(tabsModule))

const tabsPlugin = await tabsModule.SidebarTabsPlugin()
console.log("   Hooks:", Object.keys(tabsPlugin))

// Check ui.register
const registerOutput: any = {}
await tabsPlugin["ui.register"]({}, registerOutput)
console.log("   Registered panels:", registerOutput.panels)

// Check ui.render
const renderOutput: any = {}
await tabsPlugin["ui.render"](
  {
    componentId: "sidebar-tabs",
    context: {
      theme: {},
      sync: { data: { mcp: {}, lsp: [] } },
      todo: () => [],
      toolsUsed: () => [],
    },
  },
  renderOutput,
)

console.log("   Component returned:", !!renderOutput.component)
console.log("   Component type:", renderOutput.type)

console.log("\n2. Loading context-panel from dist...")
const contextModule = await import("./examples/plugin-sidebar-context/dist/index.js")
console.log("   Exports:", Object.keys(contextModule))

const contextPlugin = await contextModule.ContextPanelPlugin()
console.log("   Hooks:", Object.keys(contextPlugin))

console.log("\n=== Test Complete ===")
