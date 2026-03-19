import os from "os"
import path from "path"
import fs from "fs/promises"

// Set XDG env vars BEFORE any src/ imports to isolate from real data
const dir = path.join(os.tmpdir(), "opencode-test-projection-" + process.pid)
await fs.mkdir(dir, { recursive: true })
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

const { Instance } = await import("@/project/instance")
const { Database } = await import("@/storage/db")
const { GlobalBus } = await import("@/bus/global")
const { Bus } = await import("@/bus")
const { Session } = await import("@/session")
const { Server } = await import("@/server/server")
const { SessionPrompt } = await import("@/session/prompt")

async function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function run() {
  console.log("project id:", Instance.project.id)

  // start the server
  const server = Server.listen({
    port: 0,
    hostname: "127.0.0.1",
  })
  console.log("server listening on:", server.url.toString())
  console.log("SSE endpoint:", `${server.url}event`)

  const base = server.url.toString().replace(/\/$/, "")
  console.log("\nServer running. Try:")
  console.log(`  curl -N ${base}/event`)
  console.log("\nPress Ctrl+C to stop.\n")

  while (1) {
    await wait(5000)

    const session = await Session.create({
      title: "test session",
    })
    console.log("created session:", session.id, session.title)

    // send messages to the session
    async function prompt(text: string) {
      console.log(`\n--- sending: "${text}" ---`)
      await SessionPrompt.prompt({
        sessionID: session.id,
        parts: [{ type: "text", text }],
      })
      console.log(`--- done: "${text}" ---`)
    }

    await prompt("What is 2 + 2?")
    await wait(2500)
    await prompt("Now multiply that by 10")
    await wait(2500)
    await prompt("Summarize what we've discussed")
  }

  await new Promise(() => {})
}

await Instance.provide({
  directory: "~/tmp/project-test7",
  fn: run,
})
