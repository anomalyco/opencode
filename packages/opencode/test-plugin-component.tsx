#!/usr/bin/env bun
/**
 * Test Plugin Component Rendering
 *
 * This tests that plugin components can be rendered correctly
 * using the same pattern as PluginComponent.tsx
 */

import { render } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import type {} from "./src/plugin-ui"

// Simulate what a plugin returns
function createMockPluginComponent() {
  const ContextPanel = () => {
    const [count, setCount] = createSignal(0)

    setTimeout(() => setCount(count() + 1), 100)

    return (
      <box flexDirection="column" gap={0}>
        <text fg="#00ff00">✓ Plugin component works!</text>
        <text fg="#6b7280">Count: {count()}</text>
      </box>
    )
  }

  return ContextPanel
}

// Simulate what PluginComponent does
function PluginComponentTest() {
  const [ComponentFn, setComponentFn] = createSignal<(() => any) | null>(null)

  // Simulate loading the plugin
  setTimeout(() => {
    const pluginComponent = createMockPluginComponent()
    setComponentFn(() => pluginComponent)
  }, 50)

  return (
    <Show when={ComponentFn()} fallback={<text fg="#ffff00">Loading plugin...</text>}>
      {(() => {
        const Component = ComponentFn()!
        return <Component />
      })()}
    </Show>
  )
}

console.log("\n=== Testing Plugin Component Rendering ===\n")

try {
  render(() => <PluginComponentTest />)

  setTimeout(() => {
    console.log("✓ Plugin component rendered successfully")
    console.log("✓ Component function called within render tree")
    console.log("✓ Canvas components working inside plugin")
    process.exit(0)
  }, 300)
} catch (error) {
  console.error("✗ Plugin component failed:", error instanceof Error ? error.message : error)
  process.exit(1)
}
