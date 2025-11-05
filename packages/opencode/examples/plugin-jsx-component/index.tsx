/**
 * JSX Component Plugin Example for OpenCode
 *
 * Demonstrates how to export actual JSX/Solid.js components from plugins
 * instead of just text strings. This allows:
 * - Full Solid.js reactivity with createSignal, createMemo, etc.
 * - Mouse and keyboard event handlers (onMouseUp, onClick, etc.)
 * - Colors and theming with theme context
 * - Complex visual components (progress bars, icons, layouts)
 */

import type { Plugin } from "@opencode-ai/plugin"
import type { WidgetDefinition } from "../../src/ui/types"
import { createSignal, Show, For } from "solid-js"
import { TextAttributes } from "@opentui/core"

// This plugin exports actual JSX components that will be rendered in the TUI
export const JSXComponentPlugin = async (ctx: any) => {
  return {
    "ui.register": async (
      _input: { platform: "tui" | "desktop"; version: string },
      output: {
        widgets?: WidgetDefinition[]
      },
    ) => {
      output.widgets = [
        {
          id: "click-counter",
          label: "Click Counter Widget",
          sidebarPosition: "top",
        },
        {
          id: "colored-stars",
          label: "Colored Stars Widget",
          sidebarPosition: "top",
        },
      ]
    },

    "ui.render": async (
      input: {
        componentId: string
        context: Record<string, any>
      },
      output: {
        content?: string
        component?: any
        type?: "text" | "markdown" | "ansi" | "html" | "component"
        error?: string
      },
    ) => {
      const { componentId, context } = input

      // Example 1: Interactive click counter with state
      if (componentId === "click-counter") {
        const [count, setCount] = createSignal(0)

        output.component = (
          <box flexDirection="column" gap={1}>
            <text attributes={TextAttributes.BOLD}>Click Counter Demo</text>
            <text
              fg="#00FF00"
              onMouseUp={() => {
                setCount(count() + 1)
              }}
            >
              Clicks: {count()} (click to increment)
            </text>
            <Show when={count() > 5}>
              <text fg="#FFD700">🎉 You clicked more than 5 times!</text>
            </Show>
          </box>
        )
        output.type = "component"
      }

      // Example 2: Colored stars with mouse handlers
      else if (componentId === "colored-stars") {
        const [selectedStar, setSelectedStar] = createSignal<number | null>(null)
        const stars = [
          { id: 1, color: "#FFD700", label: "Gold Star" },
          { id: 2, color: "#00FFFF", label: "Cyan Star" },
          { id: 3, color: "#FF69B4", label: "Pink Star" },
        ]

        output.component = (
          <box flexDirection="column" gap={1}>
            <text attributes={TextAttributes.BOLD}>Colored Stars Demo</text>
            <For each={stars}>
              {(star) => (
                <box flexDirection="row" gap={1}>
                  <text fg={star.color} onMouseUp={() => setSelectedStar(star.id)}>
                    ⭐
                  </text>
                  <text fg={selectedStar() === star.id ? star.color : "#808080"}>
                    {star.label}
                    <Show when={selectedStar() === star.id}> (selected)</Show>
                  </text>
                </box>
              )}
            </For>
          </box>
        )
        output.type = "component"
      }
    },
  }
}

export default JSXComponentPlugin
