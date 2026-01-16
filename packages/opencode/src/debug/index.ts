import fs from "fs/promises"
import path from "path"
import z from "zod"

export namespace Debug {
  export const IngestEntry = z.object({
    id: z.string().optional(),
    timestamp: z.number(),
    location: z.string(),
    message: z.string(),
    data: z.record(z.string(), z.any()),
    sessionId: z.string(),
    runId: z.string(),
    hypothesisId: z.string(),
  })
  export type IngestEntry = z.infer<typeof IngestEntry>

  export function logFileAbsolute(worktreeRoot: string) {
    return path.join(worktreeRoot, ".opencode", "debug.log")
  }

  export function configSystemBlock(input: { requestUrl: string; sessionID: string; worktreeRoot: string }) {
    const url = new URL(input.requestUrl)
    if (url.hostname === "opencode.internal") {
      url.hostname = "localhost"
      if (!url.port) url.port = "4096"
    }
    const ingestUrl = new URL(`/ingest/${input.sessionID}`, url.origin).toString()
    const logFileRelative = ".opencode/debug.log"
    const logFileAbsolute = Debug.logFileAbsolute(input.worktreeRoot)

    return [
      "<debug_config>",
      `ingestUrl: ${ingestUrl}`,
      `logFileRelative: ${logFileRelative}`,
      `logFileAbsolute: ${logFileAbsolute}`,
      "instrumentation: POST JSON logs to ingestUrl (do not write debug.log directly; the server will write it)",
      "format: NDJSON (one JSON object per line)",
      "requiredFields: sessionId, runId, hypothesisId, location, message, data, timestamp",
      "</debug_config>",
    ].join("\n")
  }

  export function shouldAppendDebugConfig(agent?: string, system?: string): boolean {
    return agent === "debug" && !system?.includes("<debug_config>")
  }

  export function appendDebugConfig(
    system: string | undefined,
    config: { requestUrl: string; sessionID: string; worktreeRoot: string },
  ): string {
    const block = configSystemBlock(config)
    return system ? [system, block].join("\n\n") : block
  }

  export async function appendLogLines(input: { worktreeRoot: string; lines: string[] }) {
    const dir = path.join(input.worktreeRoot, ".opencode")
    const file = path.join(dir, "debug.log")
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(file, input.lines.map((l) => (l.endsWith("\n") ? l : l + "\n")).join(""), "utf8")
  }
}
