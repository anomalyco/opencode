import { resolveWorkspaceURI } from "../util/workspace.js"
import type { Orchestrator } from "../orchestrator/index.js"

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /glpat-[a-zA-Z0-9\-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /[a-f0-9]{40}/g,
]

function redactSecrets(text: string): string {
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    text = text.replace(pattern, "[REDACTED]")
  }
  return text
}

export function createToolExecuteBeforeHook(orch: Orchestrator, projectRoot: string) {
  return async (input: { tool: string; sessionID: string; callID: string }, output: { args: any }): Promise<void> => {
    const agents = orch.list()
    const agent = agents.find((a) => a.id === input.sessionID)
    if (!agent) return

    const resolveArg = (val: unknown): unknown => {
      if (typeof val === "string" && val.includes("://")) {
        try {
          return resolveWorkspaceURI(val, agent.id, projectRoot)
        } catch {}
      }
      return val
    }

    if (output.args?.filePath) output.args.filePath = resolveArg(output.args.filePath)
    if (output.args?.path) output.args.path = resolveArg(output.args.path)
  }
}

export function createToolExecuteAfterHook(orch: Orchestrator) {
  return async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ): Promise<void> => {
    if (output.output) {
      output.output = redactSecrets(output.output)
    }
    if (input.tool === "edit" || input.tool === "write") {
      const agents = orch.list()
      const agent = agents.find((a) => a.id === input.sessionID)
      if (agent && output.metadata?.filePath) {
        await orch.audit.append({
          agent: agent.id,
          action: "file.change",
          target: output.metadata.filePath,
        })
      }
    }
  }
}
