/**
 * Context Panel Plugin - Using Plugin UI Canvas
 *
 * This plugin uses ONLY the approved Plugin UI Canvas components.
 * This ensures it will work correctly in the TUI renderer context.
 */

/** @jsxImportSource @opentui/solid */

import { createSignal, onMount, onCleanup, For } from "../../src/plugin-ui"

export const ContextPanelPlugin = async () => {
  return {
    "ui.register": async (_input: any, output: any) => {
      // Register a panel that will appear in the sidebar
      output.panels = [
        {
          id: "context-panel",
          label: "Context",
          icon: "📊",
          area: "left",
          position: "top",
          collapsible: true,
        },
      ]

      // Subscribe to session updates so we can refresh when context changes
      output.subscriptions = {
        events: ["session.updated", "context.updated"],
        session: true,
      }
    },

    "ui.render": async (input: any, output: any) => {
      if (input.componentId === "context-panel") {
        const { client, sessionID, messages, sync } = input.context

        // Component that fetches and displays context info
        const ContextPanel = () => {
          console.log("[ContextPanel] Initialized with sessionID:", sessionID)

          const [context, setContext] = createSignal({
            tokens: 0,
            tokenLimit: 200000,
            systemTokens: 0,
            assistantTokens: 0,
            userTokens: 0,
            toolTokens: 0,
            percentage: 0,
            cost: 0,
          })

          const calculateContext = () => {
            try {
              // Calculate context from messages (like old sidebar does)
              const msgs = messages()
              if (!msgs || msgs.length === 0) {
                setContext({
                  tokens: 0,
                  tokenLimit: 200000,
                  systemTokens: 0,
                  assistantTokens: 0,
                  userTokens: 0,
                  toolTokens: 0,
                  percentage: 0,
                  cost: 0,
                })
                return
              }

              const last = msgs.findLast((x: any) => x.role === "assistant" && x.tokens?.output > 0)

              if (!last || !last.tokens) {
                setContext({
                  tokens: 0,
                  tokenLimit: 200000,
                  systemTokens: 0,
                  assistantTokens: 0,
                  userTokens: 0,
                  toolTokens: 0,
                  percentage: 0,
                  cost: 0,
                })
                return
              }

              // System prompt (cache write tokens)
              const systemTokens = last.tokens.cache?.write || 0

              // Assistant tokens (output + reasoning)
              const assistantTokens = (last.tokens.output || 0) + (last.tokens.reasoning || 0)

              // User tokens (input excluding cache)
              const userTokens = Math.max(
                0,
                (last.tokens.input || 0) - (last.tokens.cache?.read || 0),
              )

              // Tool tokens (cache read)
              const toolTokens = last.tokens.cache?.read || 0

              const total = systemTokens + assistantTokens + userTokens + toolTokens

              // Get token limit from provider - sync is sync.data from sidebar
              const providers = sync?.provider || []
              const model = providers.find((x: any) => x.id === last.providerID)?.models[
                last.modelID
              ]
              const tokenLimit = model?.limit?.context || 200000

              // Calculate cost
              const costValue = last.cost || 0

              setContext({
                tokens: total,
                tokenLimit,
                systemTokens,
                assistantTokens,
                userTokens,
                toolTokens,
                percentage: tokenLimit ? Math.round((total / tokenLimit) * 100) : 0,
                cost: costValue,
              })
            } catch (error) {
              console.error("[ContextPanel] Error calculating context:", error)
            }
          }

          onMount(() => {
            calculateContext()
            // Poll for updates every 2 seconds
            const interval = setInterval(calculateContext, 2000)
            onCleanup(() => clearInterval(interval))
          })

          const formatNumber = (num: number) => {
            return new Intl.NumberFormat().format(num)
          }

          const formatCost = (cost: number) => {
            return `$${cost.toFixed(4)}`
          }

          // Calculate bar segments
          const barSegments = () => {
            const barWidth = 38
            const total = context().tokens

            const segments: Array<{ char: string; color: string; count: number }> = []

            // If no tokens, show empty bar
            if (total === 0) {
              segments.push({ char: "─", color: "#6b7280", count: barWidth })
              return segments
            }

            // System tokens - muted gray
            const systemCount = Math.round(
              (context().systemTokens / context().tokenLimit) * barWidth,
            )
            if (systemCount > 0) {
              segments.push({ char: "█", color: "#6b7280", count: systemCount })
            }

            // Assistant tokens - blue
            const assistantCount = Math.round(
              (context().assistantTokens / context().tokenLimit) * barWidth,
            )
            if (assistantCount > 0) {
              segments.push({ char: "█", color: "#3b82f6", count: assistantCount })
            }

            // Tool tokens - green
            const toolCount = Math.round((context().toolTokens / context().tokenLimit) * barWidth)
            if (toolCount > 0) {
              segments.push({ char: "█", color: "#10b981", count: toolCount })
            }

            // User tokens - purple
            const userCount = Math.round((context().userTokens / context().tokenLimit) * barWidth)
            if (userCount > 0) {
              segments.push({ char: "█", color: "#8b5cf6", count: userCount })
            }

            return segments
          }

          return (
            <box flexDirection="column" gap={0} marginTop={1}>
              <box flexDirection="row" paddingLeft={0} paddingRight={0}>
                <For each={barSegments()}>
                  {(segment) => (
                    <>
                      {Array.from({ length: segment.count }).map(() => (
                        <text fg={segment.color}>{segment.char}</text>
                      ))}
                    </>
                  )}
                </For>
              </box>

              <text fg="#6b7280" marginTop={1}>
                {formatNumber(context().tokens)} tokens
              </text>
              <text fg="#6b7280">{context().percentage}% used</text>
              <text fg="#6b7280">{formatCost(context().cost)} spent</text>

              {/* Legend */}
              <box flexDirection="column" marginTop={1} gap={0}>
                <box flexDirection="row" gap={1}>
                  <text fg="#6b7280">█</text>
                  <text fg="#6b7280">system</text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg="#3b82f6">█</text>
                  <text fg="#6b7280">assistant</text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg="#10b981">█</text>
                  <text fg="#6b7280">tools</text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg="#8b5cf6">█</text>
                  <text fg="#6b7280">user</text>
                </box>
              </box>
            </box>
          )
        }

        // Return the component FUNCTION, not the JSX
        // This way it will be called later within the render tree
        output.component = ContextPanel
        output.type = "component"
      }
    },

    "ui.event": async (input: any, output: any) => {
      // When session or context updates, trigger a refresh
      if (
        input.componentId === "context-panel" &&
        (input.event.type === "session.updated" || input.event.type === "context.updated")
      ) {
        output.refresh = true
      }
    },
  }
}

export default ContextPanelPlugin
