import { Session } from "../../session"
import type { SessionID } from "../../session/schema"
import { Knowledge } from "../index"
import { Log } from "../../util/log"

const log = Log.create({ service: "knowledge.extractors.logs" })

export namespace LogExtractor {
  export async function extract(sessionID: SessionID): Promise<void> {
    try {
      const session = await Session.get(sessionID)
      if (!session) return

      // Extract detailed change metrics
      const summary = session.summary
      const filesAdded = summary?.files ?? 0
      const linesAdded = summary?.additions ?? 0
      const linesDeleted = summary?.deletions ?? 0

      // Determine what was built
      const what = session.title || `Session ${sessionID}`

      // How: Describe the approach/methodology
      const how = buildHowDescription(session)

      // Where: Location in codebase
      const where = buildWhereDescription(session)

      // Tags based on what was done
      const tags = buildTags(session, filesAdded, linesAdded)

      await Knowledge.writeLog({
        sessionID,
        agent: "session-auto",
        build: { what, how, where },
        changes: {
          filesAdded,
          linesAdded,
          testsAdded: 0, // Could parse from diffs if needed
        },
        tags,
      })

      log.info("log extracted", { sessionID, what, filesAdded, linesAdded })
    } catch (err) {
      log.error("log extraction failed", { error: err, sessionID })
    }
  }

  function buildHowDescription(session: any): string {
    // Analyze message history to infer methodology
    // Note: session doesn't have messages property directly
    // This would need to be fetched separately via Session.messages()
    const toolCount = countToolExecutions(session)

    if (toolCount > 5) return "Iterative implementation with multiple tool executions"
    if (toolCount > 0) return "Implementation with agent assistance"
    return "Automated session"
  }

  function buildWhereDescription(session: any): string {
    // Extract primary directory from changes
    const diffs = session.summary?.diffs ?? []
    if (diffs.length === 0) return "Session workspace"

    // Get common directory prefix
    const paths = diffs.map((d: any) => d.path).filter(Boolean)
    if (paths.length === 0) return "Session workspace"

    const commonDir = getCommonDirectory(paths)
    return commonDir || "Session workspace"
  }

  function buildTags(session: any, filesAdded: number, linesAdded: number): string[] {
    const tags = ["auto-log", "session-end"]

    // Tag by scope
    if (filesAdded > 10) tags.push("large-change")
    if (filesAdded > 0) tags.push("feature")
    if (linesAdded > 500) tags.push("significant-work")

    // Tag by type (infer from title if possible)
    const title = session.title?.toLowerCase() || ""
    if (title.includes("test")) tags.push("testing")
    if (title.includes("fix") || title.includes("bug")) tags.push("bugfix")
    if (title.includes("refactor")) tags.push("refactor")
    if (title.includes("doc")) tags.push("documentation")

    return tags
  }

  function countToolExecutions(session: any): number {
    // Tool executions are tracked in session summary diffs
    // This is a placeholder - actual implementation would query Session.messages()
    return 0
  }

  function getCommonDirectory(paths: string[]): string {
    if (paths.length === 0) return ""

    const parts = paths[0].split("/").slice(0, -1)
    for (let i = 1; i < paths.length; i++) {
      const pathParts = paths[i].split("/").slice(0, -1)
      let j = 0
      while (j < parts.length && j < pathParts.length && parts[j] === pathParts[j]) j++
      parts.length = j
    }

    return parts.join("/") || "src/"
  }
}
