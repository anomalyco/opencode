import { Log } from "@/util/log"

export namespace SessionStatusMessage {
  const TRUNCATE_LENGTH = 60
  const log = Log.create({ service: "session.status-message" })

  function truncate(str: string | undefined): string {
    if (!str) return "..."
    if (str.length <= TRUNCATE_LENGTH) return str
    return str.slice(0, TRUNCATE_LENGTH) + "..."
  }

  function mask(cmd: string | undefined): string {
    if (!cmd) return "..."
    // Mask env var setting like TOKEN=abc -> TOKEN=***
    return cmd.replace(/(\w+)=([^\s]+)/g, "$1=***")
  }

  const formatters: Record<string, (input: any) => string> = {
    bash: (i) => `Running: ${truncate(mask(i?.command))}`,
    read: (i) => `Reading: ${truncate(i?.filePath)}`,
    write: (i) => `Writing: ${truncate(i?.filePath)}`,
    edit: (i) => `Editing: ${truncate(i?.filePath)}`,
    glob: (i) => `Finding: ${truncate(i?.pattern)}`,
    grep: (i) => `Searching: ${truncate(i?.pattern)}`,
    webfetch: (i) => `Fetching: ${truncate(i?.url)}`,
    task: (i) => `Task: ${truncate(i?.description)}`,
    question: (i) => `Question: ${truncate(i?.question)}`,
  }

  export function generate(tool: string, input: any): string {
    try {
      const fn = formatters[tool]
      if (fn) return fn(input)
      return `Using ${tool}...`
    } catch (e) {
      log.error("failed to generate status message", { tool, error: e })
      return `Using ${tool}...`
    }
  }
}
