/**
 * Minimal Test Plugin - No Canvas components
 */

// CRITICAL: Import JSX runtime for OpenTUI
/** @jsxImportSource @opentui/solid */

export const MinimalPlugin = async () => {
  return {
    "ui.register": async (_input: any, output: any) => {
      output.panels = [
        {
          id: "test-minimal",
          label: "Test",
          icon: "🧪",
          area: "left",
          position: "top",
          collapsible: true,
        },
      ]
    },

    "ui.render": async (input: any, output: any) => {
      if (input.componentId === "test-minimal") {
        const TestPanel = () => {
          return <text fg="#00ff00">✓ Minimal plugin works!</text>
        }

        output.component = TestPanel
        output.type = "component"
      }
    },
  }
}

export default MinimalPlugin
