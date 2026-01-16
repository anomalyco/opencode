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
    const origin = new URL(input.requestUrl).origin
    const ingestUrl = new URL(`/ingest/${input.sessionID}`, origin).toString()
    const logFileRelative = ".opencode/debug.log"
    const logFileAbsolute = Debug.logFileAbsolute(input.worktreeRoot)
    return [
      "<debug_config>",
      `ingestUrl: ${ingestUrl}`,
      `logFileRelative: ${logFileRelative}`,
      `logFileAbsolute: ${logFileAbsolute}`,
      "format: NDJSON (one JSON object per line)",
      "requiredFields: sessionId, runId, hypothesisId, location, message, data, timestamp",
      "</debug_config>",
    ].join("\n")
  }

  export async function appendLogLines(input: { worktreeRoot: string; lines: string[] }) {
    const dir = path.join(input.worktreeRoot, ".opencode")
    const file = path.join(dir, "debug.log")
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(file, input.lines.map((l) => (l.endsWith("\n") ? l : l + "\n")).join(""), "utf8")
  }
}
