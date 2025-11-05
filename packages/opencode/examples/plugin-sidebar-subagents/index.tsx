/**
 * Subagents Plugin
 *
 * Displays child sessions (subagents) with their status and provides navigation
 */

/** @jsxImportSource @opentui/solid */

import { createSignal, onMount, onCleanup, For, Show } from "../../src/plugin-ui"

export const SubagentsPlugin = async () => {
  return {
    "ui.register": async (_input: any, output: any) => {
      output.panels = [
        {
          id: "subagents-panel",
          label: "Subagents",
          icon: "🤖",
          area: "left",
          position: "bottom",
          collapsible: true,
        },
      ]
    },

    "ui.render": async (input: any, output: any) => {
      if (input.componentId === "subagents-panel") {
        const { sessionID, theme, renderer, navigate, sdk } = input.context

        const SubagentsPanel = () => {
          const [childSessions, setChildSessions] = createSignal<any[]>([])

          const loadChildSessions = async () => {
            try {
              const response = await fetch(`${sdk.url}/session/${sessionID}/children`)
              if (response.ok) {
                const children = await response.json()
                setChildSessions(children || [])
              }
            } catch (error) {
              console.error("[SubagentsPanel] Failed to load child sessions:", error)
            }
          }

          onMount(() => {
            loadChildSessions()
            // Poll for updates every 2 seconds
            const interval = setInterval(loadChildSessions, 2000)
            onCleanup(() => clearInterval(interval))
          })

          return (
            <Show
              when={childSessions().length > 0}
              fallback={
                <text fg={theme.textMuted} marginTop={1}>
                  No active subagents
                </text>
              }
            >
              <box flexDirection="column" gap={0} marginTop={1}>
                <For each={childSessions()}>
                  {(child) => {
                    const status = child.orchestration?.status || "unknown"
                    const statusColor =
                      status === "active"
                        ? theme.success
                        : status === "completed"
                          ? theme.textMuted
                          : status === "paused"
                            ? theme.warning
                            : theme.error

                    const titleShort =
                      child.title.length > 35 ? child.title.substring(0, 32) + "..." : child.title

                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          navigate({
                            type: "session",
                            sessionID: child.id,
                          })
                        }}
                      >
                        <text flexShrink={0} fg={statusColor}>
                          ●
                        </text>
                        <text fg={theme.text}>{titleShort}</text>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
          )
        }

        // Return the component FUNCTION, not JSX
        output.component = SubagentsPanel
        output.type = "component"
      }
    },
  }
}

export default SubagentsPlugin
