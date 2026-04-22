import type { ToolKind } from "@agentclientprotocol/sdk"

export namespace ParseCommand {
  export interface Result {
    kind: ToolKind
    title: string
    locations: { path: string }[]
    terminalOutput: boolean
  }

  export function format(command: string, description: string, cwd: string): Result {
    const title = description || command || "Terminal"

    return {
      kind: "other",
      title,
      locations: cwd ? [{ path: cwd }] : [],
      terminalOutput: true,
    }
  }
}
