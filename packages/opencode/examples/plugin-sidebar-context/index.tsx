/**
 * Context Panel Plugin - Simple Working Version
 *
 * This plugin uses basic SolidJS signals without complex loops.
 * Works correctly in the TUI renderer context.
 */

/** @jsxImportSource @opentui/solid */

import { createSignal, onMount, onCleanup } from "../../src/plugin-ui"

export const ContextPanelPlugin = async () => {
  return {
    "ui.register": async (_input: any, output: any) => {
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

      output.subscriptions = {
        events: ["session.updated", "context.updated"],
        session: true,
      }
    },

    "ui.render": async (input: any, output: any) => {
      if (input.componentId === "context-panel") {
        const { sessionID, messages, sync } = input.context

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

              const systemTokens = last.tokens.cache?.write || 0
              const assistantTokens = (last.tokens.output || 0) + (last.tokens.reasoning || 0)
              const userTokens = Math.max(
                0,
                (last.tokens.input || 0) - (last.tokens.cache?.read || 0),
              )
              const toolTokens = last.tokens.cache?.read || 0
              const total = systemTokens + assistantTokens + userTokens + toolTokens

              const providers = sync?.provider || []
              const model = providers.find((x: any) => x.id === last.providerID)?.models[
                last.modelID
              ]
              const tokenLimit = model?.limit?.context || 200000

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
            const interval = setInterval(calculateContext, 2000)
            onCleanup(() => clearInterval(interval))
          })

          const formatNumber = (num: number) => {
            return new Intl.NumberFormat().format(num)
          }

          const formatCost = (cost: number) => {
            return `$${cost.toFixed(4)}`
          }

          // Calculate bar widths
          const barWidth = 38
          const systemBarWidth = () =>
            Math.round((context().systemTokens / context().tokenLimit) * barWidth)
          const assistantBarWidth = () =>
            Math.round((context().assistantTokens / context().tokenLimit) * barWidth)
          const toolBarWidth = () =>
            Math.round((context().toolTokens / context().tokenLimit) * barWidth)
          const userBarWidth = () =>
            Math.round((context().userTokens / context().tokenLimit) * barWidth)

          // Generate bar characters
          const systemBar = () => "█".repeat(systemBarWidth())
          const assistantBar = () => "█".repeat(assistantBarWidth())
          const toolBar = () => "█".repeat(toolBarWidth())
          const userBar = () => "█".repeat(userBarWidth())

          return (
            <box flexDirection="column" gap={0} marginTop={1}>
              <box flexDirection="row" paddingLeft={0} paddingRight={0}>
                <text fg="#6b7280">{systemBar()}</text>
                <text fg="#3b82f6">{assistantBar()}</text>
                <text fg="#10b981">{toolBar()}</text>
                <text fg="#8b5cf6">{userBar()}</text>
              </box>

              <text fg="#6b7280" marginTop={1}>
                {formatNumber(context().tokens)} tokens
              </text>
              <text fg="#6b7280">{context().percentage}% used</text>
              <text fg="#6b7280">{formatCost(context().cost)} spent</text>

              <box flexDirection="column" marginTop={1} gap={0}>
                <box flexDirection="row" gap={1}>
                  <text fg="#6b7280">█ system</text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg="#3b82f6">█ assistant</text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg="#10b981">█ tools</text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg="#8b5cf6">█ user</text>
                </box>
              </box>
            </box>
          )
        }

        output.component = ContextPanel
        output.type = "component"
      }
    },

    "ui.event": async (input: any, output: any) => {
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
