import { Log } from "@/util/log"
import { Scheduler } from "../scheduler"
import { Session } from "."
import { SessionPrompt } from "./prompt"
import { Database } from "@/storage/db"
import { SessionTable } from "./session.sql"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"

const log = Log.create({ service: "session.cleanup" })

// Run cleanup every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

let cleanupCounter = 0

async function runCleanup() {
  const now = Date.now()
  
  try {
    // Get all sessions with TTL set
    const sessions = Database.use((db) => {
      return db
        .select()
        .from(SessionTable)
        .all()
        .filter(row => row.time_ttl !== null)
    })

    log.info("ttl cleanup scan", {
      totalSessionsWithTtl: sessions.length,
      timestamp: now,
    })

    let expiredCount = 0
    let busyCount = 0
    let deletedCount = 0

    for (const row of sessions) {
      const info = Session.fromRow(row)
      
      // Skip if TTL is not set (should not happen due to query filter, but defensive)
      if (!info.time.ttl) continue

      // Check if session has expired
      const age = now - info.time.updated
      if (age <= info.time.ttl) continue

      expiredCount++

      // Check if session is busy (has active prompt)
      try {
        SessionPrompt.assertNotBusy(info.id)
      } catch (error) {
        // Session is busy, skip deletion
        busyCount++
        log.info("ttl cleanup skipped busy session", {
          sessionID: info.id,
          age,
          ttl: info.time.ttl,
          title: info.title,
        })
        continue
      }

      // Session is expired and not busy - delete it
      log.info("ttl cleanup deleting session", {
        sessionID: info.id,
        age,
        ttl: info.time.ttl,
        title: info.title,
      })

      // Emit TTL expired event before deletion
      Bus.publish(Session.Event.TtlExpired, { info })
      GlobalBus.emit("event", {
        directory: info.directory,
        payload: {
          type: "session.ttl_expired",
          properties: {
            sessionID: info.id,
            title: info.title,
            age,
            ttl: info.time.ttl,
          },
        },
      })

      // Delete the session (this will cascade to messages and parts)
      await Session.remove(info.id)
      deletedCount++
    }

    cleanupCounter++
    log.info("ttl cleanup complete", {
      runCount: cleanupCounter,
      scannedWithTtl: sessions.length,
      expired: expiredCount,
      busy: busyCount,
      deleted: deletedCount,
    })
  } catch (error) {
    log.error("ttl cleanup failed", { error })
  }
}

export function registerSessionCleanup() {
  Scheduler.register({
    id: "session-ttl-cleanup",
    interval: CLEANUP_INTERVAL_MS,
    run: runCleanup,
    scope: "global",
  })
  
  log.info("session ttl cleanup registered", {
    intervalMs: CLEANUP_INTERVAL_MS,
  })
}
