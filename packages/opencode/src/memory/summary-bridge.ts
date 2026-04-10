import { Log } from "@/util/log"
import { MemoryExtractor } from "./extractor"

const log = Log.create({ service: "memory.summary-bridge" })

// Marker used in compaction prompts to identify memory candidates
const MEMORY_CANDIDATES_MARKER = "## Memory Candidates"

export namespace SummaryBridge {
  /**
   * Extracts long-term memory candidates from compaction summary text.
   * Called after compaction completes, fire-and-forget.
   */
  export async function extractMemoryCandidates(
    summaryText: string,
    sessionID: string,
    projectPath: string,
  ): Promise<void> {
    const section = extractSection(summaryText, MEMORY_CANDIDATES_MARKER)
    if (!section) return

    const candidates = parseMemoryCandidates(section)
    if (candidates.length === 0) return

    for (const candidate of candidates) {
      try {
        MemoryExtractor.trackDecision(sessionID, candidate.name, candidate.content)
      } catch (err) {
        log.warn("failed to extract memory candidate", { error: err, name: candidate.name })
      }
    }

    log.info("extracted memory candidates from summary", { count: candidates.length, sessionID })
  }

  function extractSection(text: string, marker: string): string | undefined {
    const idx = text.indexOf(marker)
    if (idx === -1) return undefined

    const afterMarker = text.slice(idx + marker.length)
    // Find the next heading (## or end of text)
    const nextHeading = afterMarker.search(/\n## /)
    const section = nextHeading === -1 ? afterMarker : afterMarker.slice(0, nextHeading)
    return section.trim()
  }

  function parseMemoryCandidates(section: string): Array<{ name: string; content: string }> {
    const candidates: Array<{ name: string; content: string }> = []
    const lines = section.split("\n")

    for (const line of lines) {
      // Parse markdown list items: "- **Name**: Description" or "- Name: Description"
      const match = line.match(/^[-*]\s+\*?\*?(.+?)\*?\*?:\s*(.+)$/)
      if (match) {
        candidates.push({
          name: match[1].trim(),
          content: match[2].trim(),
        })
      }
    }
    return candidates
  }
}
