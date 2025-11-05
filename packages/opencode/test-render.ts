#!/usr/bin/env bun
/**
 * Test script to verify plugin rendering works
 */

import { Plugin } from "./src/plugin"
import { UIRegistry } from "./src/ui/registry"
import { Instance } from "./src/project/instance"

async function main() {
  console.log("🔍 Testing plugin render...\n")

  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      // Load plugins
      const plugins = await Plugin.list()
      console.log(`✅ Loaded ${plugins.length} plugins\n`)

      // Check what ui.render hooks exist
      console.log("Checking ui.render hooks:")
      for (const plugin of plugins) {
        const hasRender = !!(plugin as any)["ui.render"]
        console.log(`  Plugin has ui.render: ${hasRender}`)
      }
      console.log()

      // Try to render the component
      console.log("Attempting to render context-panel...")
      const result = await UIRegistry.renderComponent("context-panel", {
        sessionID: "test-session",
        theme: { text: "#fff", textMuted: "#888" },
      })

      console.log("\nRender result:")
      console.log("  Type:", result.type)
      console.log("  Has component:", !!result.component)
      console.log("  Has content:", !!result.content)
      console.log("  Error:", result.error)
      if (result.content) {
        console.log("  Content:", result.content)
      }
    },
  })
}

main().catch(console.error)
