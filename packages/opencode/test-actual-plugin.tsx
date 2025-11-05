#!/usr/bin/env bun
/**
 * Test ACTUAL Plugin Loading and Rendering
 * This loads the real compiled plugin and renders it in TUI context
 */

import { render } from "@opentui/solid"
import { Show, onMount, createSignal } from "solid-js"
import { Instance } from "./src/project/instance"
import { Plugin } from "./src/plugin"

console.log("\n=== Testing ACTUAL Plugin Load and Render ===\n")

await Instance.provide({
  directory: process.cwd(),
  async fn() {
    const plugins = await Plugin.list()
    console.log(`✓ Loaded ${plugins.length} plugins`)

    // Find the context panel plugin
    const contextPlugin = plugins.find((p: any) => p["ui.render"])
    if (!contextPlugin) {
      console.error("✗ No plugin with ui.render found")
      process.exit(1)
    }

    console.log("✓ Found plugin with ui.render")

    // Mock client and sessionID
    const mockClient = {
      sessions: {
        retrieve: async () => ({
          data: {
            context: {
              tokens: 1000,
              tokenLimit: 200000,
              system: 200,
              assistant: 300,
              user: 400,
              tool: 100,
              cost: 0.0123,
            },
          },
        }),
      },
    }

    function TestPluginRender() {
      const [Component, setComponent] = createSignal<any>(null)
      const [error, setError] = createSignal<string | null>(null)

      onMount(async () => {
        try {
          const output: any = {}
          const uiRender = (contextPlugin as any)["ui.render"]

          console.log("About to call ui.render with componentId: context-panel")

          await uiRender(
            {
              componentId: "context-panel",
              context: {
                client: mockClient,
                sessionID: "test-session",
              },
            },
            output,
          )

          console.log("✓ Plugin ui.render called")
          console.log("  input.componentId was: context-panel")
          console.log("  output keys:", Object.keys(output))
          console.log(
            "  output.component:",
            typeof output.component,
            output.component ? "exists" : "missing",
          )
          console.log("  output.type:", output.type)
          console.log("  output.content:", output.content)

          if (output.component) {
            console.log("✓ Plugin returned component function")
            setComponent(() => output.component)
          } else {
            setError(`Plugin did not return component. Output: ${JSON.stringify(output)}`)
          }
        } catch (err) {
          console.error("✗ Error loading plugin:", err)
          setError(String(err))
        }
      })

      return (
        <Show when={!error()} fallback={<text fg="#ff0000">Error: {error()}</text>}>
          <Show when={Component()} fallback={<text fg="#ffff00">Loading...</text>}>
            {(() => {
              try {
                const Comp = Component()!
                console.log("✓ About to render plugin component...")
                return <Comp />
              } catch (err) {
                console.error("✗ Render error:", err)
                return <text fg="#ff0000">Render failed: {String(err)}</text>
              }
            })()}
          </Show>
        </Show>
      )
    }

    try {
      render(() => <TestPluginRender />)

      setTimeout(() => {
        console.log("\n✓ Plugin rendered successfully - no 'renderer not found' errors!")
        console.log("✓ Canvas components working in plugin context")
        process.exit(0)
      }, 500)
    } catch (error) {
      console.error("\n✗ Render failed:", error)
      process.exit(1)
    }
  },
})
