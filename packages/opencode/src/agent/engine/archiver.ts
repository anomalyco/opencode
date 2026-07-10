import { join } from "node:path"

export interface ArchiveConfig {
  maxHotEvents: number
  archiveDir: string
  compressThreshold: number
}

export interface ArchiveResult {
  archivePath: string
  coldCount: number
  hotCount: number
  sequenceRange: [number, number]
  compressedSize: number
}

export interface EventRow {
  event_id: string
  session_id: string
  parent_event_id: string | null
  event_type: string
  payload: string
  status: string
  token_cost: number
  duration_ms: number
  sequence_index: number
  timestamp: number
}

export interface ArchiveDatabase {
  queryEvents(sessionId: string, fromSeq?: number, limit?: number): EventRow[]
  countEvents(sessionId: string): number
  deleteColdEvents(sessionId: string, maxSeqIndex: number, archivePath: string, archivedCount: number): void
}

export class EventArchiver {
  private config: ArchiveConfig
  private db: ArchiveDatabase | null = null

  constructor(config?: Partial<ArchiveConfig>) {
    this.config = {
      maxHotEvents: config?.maxHotEvents ?? 10_000,
      archiveDir: config?.archiveDir ?? "archives",
      compressThreshold: config?.compressThreshold ?? 50_000,
    }
  }

  setDatabase(db: ArchiveDatabase): void {
    this.db = db
  }

  shouldArchive(eventCount: number): boolean {
    return eventCount > this.config.maxHotEvents + 1_000
  }

  /**
   * Execute full archive cycle:
   * 1. Query cold events from DB
   * 2. Write to archive file
   * 3. Compress if above threshold
   * 4. Delete cold events from DB + insert archive_summary
   * 5. Return result
   */
  async archive(sessionId: string): Promise<ArchiveResult | null> {
    if (!this.db) return null

    const totalCount = this.db.countEvents(sessionId)
    if (!this.shouldArchive(totalCount)) return null

    const coldEvents = this.db.queryEvents(sessionId, undefined, totalCount - this.config.maxHotEvents)
    if (coldEvents.length === 0) return null

    const sequenceRange: [number, number] = [
      coldEvents[0].sequence_index,
      coldEvents[coldEvents.length - 1].sequence_index,
    ]

    // Write archive file
    const archivePath = join(this.config.archiveDir, `${sessionId}_${Date.now()}.json`)
    const archiveData = JSON.stringify(coldEvents, null, 0)

    // Ensure archive directory exists
    const dir = this.config.archiveDir
    try {
      await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }))
    } catch {
      // Directory may already exist
    }

    // Write archive data (compressed or plain)
    let finalPath = archivePath
    let compressedSize = archiveData.length
    if (this.shouldCompress(coldEvents.length)) {
      try {
        const { gzipSync } = await import("bun")
        const compressed = gzipSync(new TextEncoder().encode(archiveData))
        finalPath = `${archivePath}.gz`
        await Bun.write(finalPath, compressed)
        compressedSize = compressed.byteLength
      } catch {
        // Fallback to uncompressed
        await Bun.write(archivePath, archiveData)
      }
    } else {
      await Bun.write(archivePath, archiveData)
    }

    // Delete cold events from DB and insert archive_summary event
    this.db.deleteColdEvents(sessionId, sequenceRange[1], finalPath, coldEvents.length)

    return {
      archivePath: finalPath,
      coldCount: coldEvents.length,
      hotCount: totalCount - coldEvents.length,
      sequenceRange,
      compressedSize,
    }
  }

  getSummaryEvent(
    sessionId: string,
    sequenceRange: [number, number],
    archivePath: string,
  ): {
    event_type: string
    payload: Record<string, unknown>
  } {
    return {
      event_type: "archive_summary",
      payload: {
        archive_path: archivePath,
        event_count: sequenceRange[1] - sequenceRange[0] + 1,
        sequence_range: sequenceRange,
        session_id: sessionId,
      },
    }
  }

  estimateArchiveSize(eventCount: number, avgEventSize: number = 200): number {
    return eventCount * avgEventSize
  }

  shouldCompress(eventCount: number): boolean {
    return eventCount > this.config.compressThreshold
  }

  /** Load events from an archive file back into memory */
  async loadArchive(archivePath: string): Promise<EventRow[]> {
    const file = Bun.file(archivePath)
    if (!(await file.exists())) return []

    if (archivePath.endsWith(".gz")) {
      try {
        const { gunzipSync } = await import("bun")
        const compressed = new Uint8Array(await file.arrayBuffer())
        const decompressed = gunzipSync(compressed)
        return JSON.parse(new TextDecoder().decode(decompressed))
      } catch {
        return []
      }
    }

    return await file.json()
  }
}

export * as Archiver from "./archiver"
