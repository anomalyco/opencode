import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const directory = process.env.MCP_LIFECYCLE_DIR
if (!directory) throw new Error("MCP_LIFECYCLE_DIR is required")

const name = process.argv.includes("--grandchild") ? "grandchild" : "child"
writeFileSync(`${directory}/${name}.pid`, String(process.pid))

process.on("SIGTERM", () => {
  writeFileSync(`${directory}/${name}.term`, "received")
  if (name === "child") process.exit(0)
})

if (name === "child") {
  const grandchild = spawn(process.execPath, [fileURLToPath(import.meta.url), "--grandchild"], {
    env: process.env,
    stdio: "ignore",
  })
  void grandchild
}

setInterval(() => {}, 60_000)
