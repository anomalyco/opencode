import { metrics } from "@opentelemetry/api"

const meter = metrics.getMeter("opencode")

export const agentTurnCount = meter.createHistogram("github_copilot_agent_turn_count", {
  description: "Måler antall fullførte interaksjoner (svinger/spørsmål) med agenten",
})

export const toolCallCountTotal = meter.createCounter("github_copilot_tool_call_count_total", {
  description: "Måler totalt antall verktøykall utført av agenten",
})

export const toolCallDurationSeconds = meter.createHistogram("github_copilot_tool_call_duration_seconds", {
  description: "Måler tidsbruken for hvert enkelt verktøykall",
})

export const mcpServerConnectionCountTotal = meter.createCounter("github_copilot_mcp_server_connection_count_total", {
  description: "Måler antall opprettede tilkoblinger til Model Context Protocol (MCP) servere",
})
