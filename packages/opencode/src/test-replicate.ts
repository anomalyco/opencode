import os from "os"
import path from "path"
import fs from "fs/promises"

// Set XDG env vars BEFORE any src/ imports to isolate from real data
// const dir = path.join("/Users/james/tmp/opencode-test-replicate")
const dir = path.join(os.tmpdir(), "opencode-test-projection-" + process.pid)
await fs.mkdir(dir, { recursive: true })
console.log(dir)
process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")

// Write the cache version file
const cache = path.join(dir, "cache", "opencode")
await fs.mkdir(cache, { recursive: true })
await fs.writeFile(path.join(cache, "version"), "14")

// Now safe to import src/
const { Log } = await import("@/util/log")
Log.init({ print: true, dev: true, level: "DEBUG" })

const { Database } = await import("@/storage/db")
const { SyncEvent } = await import("@/sync")
const { parseSSE } = await import("@/control-plane/sse")
const { initProjectors } = await import("@/server/projectors")

const url = process.argv[2] || "http://127.0.0.1:4096/global/sync-event"
const ac = new AbortController()

process.on("SIGINT", () => ac.abort())
process.on("SIGTERM", () => ac.abort())

async function run() {
  const res = await fetch(url, {
    headers: { accept: "text/event-stream" },
    signal: ac.signal,
  })

  console.log(res.statusText)

  if (!res.ok) {
    console.error("failed to connect:", res.status, await res.text())
    process.exit(1)
  }

  if (!res.body) {
    console.error("no response body")
    process.exit(1)
  }

  console.log("connected, listening for events...\n")
  initProjectors()

  Database.Client()

  await parseSSE(res.body, ac.signal, (event: any) => {
    // console.log("[sse]", JSON.stringify(event, null, 2))
    const payload = event.payload
    if (!payload.type.startsWith("server.")) {
      console.log(payload)
      try {
        SyncEvent.replay({
          type: payload.type,
          id: payload.id,
          seq: payload.seq,
          aggregateID: payload.aggregateID,
          data: payload.data,
        })

        // console.log("[apply] ok:", event.type)
        console.log("db path", Database.Path)
      } catch (err) {
        console.error("[apply] error:", err)
      }
    }
  })

  console.log("\ndisconnected")
  Database.close()
  // await fs.rm(dir, { recursive: true, force: true })
}

run()
