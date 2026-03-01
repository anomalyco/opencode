type Session = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

type Message = {
  role: "user" | "assistant"
  agent?: string
  modelID?: string
  time: {
    created?: number
    completed?: number
  }
}

type Part = {
  type: string
  synthetic?: boolean
  text?: string
  tool?: string
  state?: {
    input?: unknown
    output?: string
    error?: string
    status: "pending" | "running" | "completed" | "error"
  }
}

const titlecase = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value)

const formatAssistant = (msg: Message) => {
  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""
  const agent = msg.agent ? titlecase(msg.agent) : "Assistant"
  const model = msg.modelID ?? ""
  return `## Assistant (${agent}${model ? ` · ${model}` : ""}${duration ? ` · ${duration}` : ""})\n\n`
}

const formatPart = (part: Part) => {
  if (part.type === "text" && part.text && !part.synthetic) return `${part.text}\n\n`
  if (part.type === "reasoning" && part.text) return `_Thinking:_\n\n${part.text}\n\n`
  if (part.type !== "tool" || !part.tool || !part.state) return ""

  const input = part.state.input
    ? `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`
    : ""
  const output =
    part.state.status === "completed" && part.state.output
      ? `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`
      : ""
  const error =
    part.state.status === "error" && part.state.error ? `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n` : ""
  return `**Tool: ${part.tool}**\n${input}${output}${error}\n`
}

const formatMessage = (msg: Message, parts: Part[]) => {
  const header = msg.role === "assistant" ? formatAssistant(msg) : "## User\n\n"
  return `${header}${parts.map(formatPart).join("")}`
}

export const formatSessionTranscript = (
  session: Session,
  rows: Array<{
    info: Message
    parts: Part[]
  }>,
) => {
  const header = [
    `# ${session.title}`,
    "",
    `**Session ID:** ${session.id}`,
    `**Created:** ${new Date(session.time.created).toLocaleString()}`,
    `**Updated:** ${new Date(session.time.updated).toLocaleString()}`,
    "",
    "---",
    "",
  ].join("\n")

  const body = rows
    .map((row) => `${formatMessage(row.info, row.parts)}---\n`)
    .join("\n")
    .trimEnd()

  return `${header}${body ? `\n${body}` : ""}`
}
