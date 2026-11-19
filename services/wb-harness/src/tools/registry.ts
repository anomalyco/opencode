export type ToolContext = {
  signal: AbortSignal
  timeoutMs: number
}

export type ToolResult = {
  tool: string
  ok: boolean
  summary: string
  artifacts: string[]
  data?: unknown
}

export type Tool = {
  name: string
  description: string
  /** Returns arguments when the tool should run for this text, otherwise undefined. */
  match: (text: string) => Record<string, unknown> | undefined
  run: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

const registry = new Map<string, Tool>()

export function registerTool(tool: Tool) {
  registry.set(tool.name, tool)
}

export function listTools(): Tool[] {
  return [...registry.values()]
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name)
}

export function toolsForText(text: string): Array<{ tool: Tool; args: Record<string, unknown> }> {
  return listTools().flatMap((tool) => {
    const args = tool.match(text)
    return args ? [{ tool, args }] : []
  })
}

export async function runTool(
  tool: Tool,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  try {
    return await tool.run(args, context)
  } catch (error) {
    return {
      tool: tool.name,
      ok: false,
      summary: `${tool.name}: ${error instanceof Error ? error.message : "unknown error"}`,
      artifacts: [],
    }
  }
}
