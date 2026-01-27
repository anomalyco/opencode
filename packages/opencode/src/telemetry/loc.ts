import { TelemetryProvider } from "./provider"
import { SpanKind, SpanStatusCode } from "@opentelemetry/api"

export namespace LocTelemetry {
  export interface FileChange {
    filePath: string
    additions: number
    deletions: number
    toolName: string
    changeType?: "add" | "update" | "delete" | "move"
  }

  export function recordFileChange(change: FileChange, sessionID: string): void {
    const tracer = TelemetryProvider.getTracer()
    if (!tracer) return

    const span = tracer.startSpan("file.change", {
      kind: SpanKind.INTERNAL,
      attributes: {
        "opencode.session.id": sessionID,
        "opencode.tool.name": change.toolName,
        "opencode.file.path": change.filePath,
        "opencode.loc.additions": change.additions,
        "opencode.loc.deletions": change.deletions,
        "opencode.loc.net_change": change.additions - change.deletions,
      },
    })

    if (change.changeType) {
      span.setAttribute("opencode.file.change_type", change.changeType)
    }

    span.setStatus({ code: SpanStatusCode.OK })
    span.end()
  }

  export function recordBatchChanges(changes: FileChange[], sessionID: string, toolName: string): void {
    const tracer = TelemetryProvider.getTracer()
    if (!tracer) return

    if (changes.length === 0) return

    let totalAdditions = 0
    let totalDeletions = 0
    const fileDetails = changes.map((change) => {
      totalAdditions += change.additions
      totalDeletions += change.deletions
      return {
        path: change.filePath,
        additions: change.additions,
        deletions: change.deletions,
        type: change.changeType,
      }
    })

    const span = tracer.startSpan("file.batch_change", {
      kind: SpanKind.INTERNAL,
      attributes: {
        "opencode.session.id": sessionID,
        "opencode.tool.name": toolName,
        "opencode.batch.file_count": changes.length,
        "opencode.batch.total_additions": totalAdditions,
        "opencode.batch.total_deletions": totalDeletions,
        "opencode.batch.net_change": totalAdditions - totalDeletions,
        "opencode.batch.files": JSON.stringify(fileDetails),
      },
    })

    span.setStatus({ code: SpanStatusCode.OK })
    span.end()
  }
}
