import { Component, Show } from "solid-js"
import { useAgents } from "@/context/agents"

export const ActiveAgentIndicator: Component = () => {
  const agents = useAgents()

  return (
    <Show when={agents.activeAgent()}>
      {(activeAgent) => {
        const config = agents.getAgent(activeAgent())
        return (
          <Show when={config}>
            {(agent) => (
              <div
                class="flex items-center gap-1.5 px-2 py-1 rounded-md text-11-medium"
                style={{
                  "background-color": `${agent().color}20`,
                  color: agent().color,
                }}
              >
                <div
                  class="w-2 h-2 rounded-full animate-pulse"
                  style={{ "background-color": agent().color }}
                />
                <span>{agent().name}</span>
              </div>
            )}
          </Show>
        )
      }}
    </Show>
  )
}
