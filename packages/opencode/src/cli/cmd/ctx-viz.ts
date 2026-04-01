import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { ContextViz } from "../../session/ctx-viz"
import { InstructionPrompt } from "../../session/instruction"
import { MessageV2 } from "../../session/message-v2"
import { SystemPrompt } from "../../session/system"
import { Provider } from "../../provider/provider"

export const CtxVizCommand = cmd({
  command: "ctx-viz",
  describe: "visualize context window usage breakdown",
  builder: (yargs: Argv) => {
    return yargs
      .option("session", {
        alias: "s",
        describe: "session ID (default: latest)",
        type: "string",
      })
      .option("json", {
        describe: "output as JSON",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = args.session ?? (await getLatestSessionID())

      if (!sessionID) {
        console.log("No sessions found.")
        return
      }

      // Get model info from messages
      const messages = await Session.messages(sessionID as any)
      const modelInfo = getModelInfo(messages)

      if (!modelInfo) {
        console.log("No model information found in session.")
        return
      }

      // Gather system prompt data
      const systemPromptData = await gatherSystemPromptData(modelInfo.modelID)

      // Gather message data
      const messageData = gatherMessageData(messages)

      // Estimate tool definitions (simplified - just count tools from messages)
      const toolDefinitionsTokens = estimateToolDefinitionsTokens(messages)

      // Build report
      const report = ContextViz.buildReport({
        systemPromptTokens: systemPromptData.totalTokens,
        userMessageTokens: messageData.userTokens,
        assistantMessageTokens: messageData.assistantTokens,
        toolDefinitionTokens: toolDefinitionsTokens,
        contextLimit: modelInfo.contextLimit,
        modelID: modelInfo.modelID,
      })

      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        displayReport(report)
      }
    })
  },
})

async function getLatestSessionID(): Promise<string | undefined> {
  const sessions: Session.Info[] = []
  for await (const session of Session.list()) {
    if (session) {
      sessions.push(session)
    }
  }

  // Filter out parent sessions and sort by time.updated descending
  const childSessions = sessions.filter((s) => !s.parentID)
  childSessions.sort((a, b) => b.time.updated - a.time.updated)

  return childSessions[0]?.id
}

function getModelInfo(messages: MessageV2.WithParts[]): {
  providerID: string
  modelID: string
  contextLimit: number
} | null {
  // Find the latest assistant message with model info
  for (const msg of messages) {
    if (msg.info.role === "assistant") {
      const assistant = msg.info as MessageV2.Assistant
      return {
        providerID: assistant.providerID,
        modelID: assistant.modelID,
        contextLimit: getContextLimit(assistant.modelID),
      }
    }
  }
  return null
}

function getContextLimit(modelID: string): number {
  // Default context limits based on model families
  if (
    modelID.includes("claude-3-7-sonnet") ||
    modelID.includes("claude-3.5-sonnet") ||
    modelID.includes("claude-3-opus")
  ) {
    return 200_000
  }
  if (modelID.includes("claude")) {
    return 200_000
  }
  if (modelID.includes("gpt-4o") || modelID.includes("o1") || modelID.includes("o3") || modelID.includes("gpt-5")) {
    return 200_000
  }
  if (modelID.includes("gemini")) {
    return 1_000_000
  }
  if (modelID.includes("deepseek")) {
    return 64_000
  }
  // Default fallback
  return 128_000
}

async function gatherSystemPromptData(modelID: string): Promise<{
  totalTokens: number
  breakdown: Array<{ label: string; tokens: number }>
}> {
  const provider = InstructionPrompt.system()
  const instructions = (await provider).join("\n")
  const env = (await SystemPrompt.environment({ api: { id: modelID } } as Provider.Model)).join("\n")

  const input: ContextViz.SystemPromptInput = {
    header: "",
    provider: instructions,
    environment: env,
    custom: [],
  }

  const estimate = ContextViz.estimateSystemPromptTokens(input)
  return {
    totalTokens: estimate.tokens,
    breakdown: estimate.breakdown,
  }
}

function gatherMessageData(messages: MessageV2.WithParts[]): {
  userTokens: number
  assistantTokens: number
  totalTokens: number
} {
  const contextMessages: ContextViz.Message[] = messages
    .filter((msg) => msg.info.role === "user" || msg.info.role === "assistant")
    .map((msg) => {
      const content = msg.parts
        .filter((part) => part.type === "text" || part.type === "reasoning")
        .map((part) => (part.type === "text" ? part.text : part.text))
        .join("\n")
      return {
        role: msg.info.role,
        content,
      }
    })

  return ContextViz.estimateMessagesTokens(contextMessages)
}

function estimateToolDefinitionsTokens(messages: MessageV2.WithParts[]): number {
  // Extract unique tool names from messages
  const tools = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool") {
        tools.add(part.tool)
      }
    }
  }

  // Simple estimation: each tool name + basic schema = ~100 tokens
  // This is a rough estimate since we don't have actual tool definitions
  const toolDefinitions: ContextViz.ToolDefinition[] = Array.from(tools).map((name) => ({
    name,
    description: `Tool ${name} for code operations`,
    schema: `{"type": "object", "properties": {}}`,
  }))

  const estimate = ContextViz.estimateToolDefinitionsTokens(toolDefinitions)
  return estimate.tokens
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + "M"
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + "K"
  }
  return num.toString()
}

function getColorForUsage(percent: number): string {
  if (percent < 0.5) return "\x1B[32m" // green
  if (percent < 0.8) return "\x1B[33m" // yellow
  return "\x1B[31m" // red
}

function renderProgressBar(percent: number, width: number): string {
  const filled = Math.round(percent * width)
  const empty = width - filled
  return "█".repeat(filled) + "░".repeat(empty)
}

function displayReport(report: ContextViz.Report) {
  const width = 56
  const usagePercent = report.usagePercent * 100

  function renderRow(label: string, value: string): string {
    const availableWidth = width - 1
    const paddingNeeded = availableWidth - label.length - value.length
    const padding = Math.max(0, paddingNeeded)
    return `│${label}${" ".repeat(padding)}${value} │`
  }

  // Header section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│              CONTEXT WINDOW VISUALIZATION              │")
  console.log("├────────────────────────────────────────────────────────┤")
  console.log(renderRow("Model", report.modelID))
  console.log(renderRow("Total Tokens", formatNumber(report.totalTokens)))
  console.log(renderRow("Context Limit", formatNumber(report.contextLimit)))

  // Usage percentage with color and progress bar
  const color = getColorForUsage(report.usagePercent)
  const progressBar = renderProgressBar(report.usagePercent, 20)
  const usageStr = `${color}${usagePercent.toFixed(1)}%${"\x1B[0m"}`
  const barRow = `│ Usage: ${progressBar} ${usageStr.padEnd(8)} │`

  console.log(barRow)
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Segments breakdown
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                   TOKEN BREAKDOWN                      │")
  console.log("├────────────────────────────────────────────────────────┤")

  for (const segment of report.segments) {
    const label = segment.label
    const tokens = formatNumber(segment.tokens)
    const percent = (segment.percent * 100).toFixed(1)

    // Create progress bar for segment
    const segmentBar = renderProgressBar(segment.percent, 12)
    const color = getColorForUsage(segment.percent)

    const content = ` ${label.padEnd(18)} ${segmentBar} ${color}${percent.padStart(5)}%${"\x1B[0m"} (${tokens.padStart(8)})`
    const padding = Math.max(0, width - content.length - 1)
    console.log(`│${content}${" ".repeat(padding)} │`)
  }

  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Legend
  console.log("  Colors: \x1B[32m■\x1B[0m <50%  \x1B[33m■\x1B[0m 50-80%  \x1B[31m■\x1B[0m >80%")
  console.log()
}
