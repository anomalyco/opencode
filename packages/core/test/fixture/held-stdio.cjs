const { spawn } = require("node:child_process")
const fs = require("node:fs")

const mode = process.argv[2]
const child = spawn(
  process.execPath,
  [
    "-e",
    `
  process.on("SIGTERM", () => {})
  process.stdout.on("error", () => {})
  process.stderr.on("error", () => {})
  process.send("ready")
  setTimeout(() => process.exit(0), 15000)
`,
  ],
  {
    detached: mode !== "mcp",
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  },
)
fs.writeFileSync(process.argv[3], String(child.pid))

child.once("message", () => {
  child.disconnect()
  child.unref()
  if (mode === "mcp") {
    fs.writeSync(1, JSON.stringify({ jsonrpc: "2.0", method: "ready" }) + "\n")
    process.stdin.resume().once("end", () => process.exit(0))
    return
  }
  fs.writeSync(1, "foreground-out\n")
  fs.writeSync(2, "foreground-err\n")
  if (mode === "exit") process.exit(0)
  setTimeout(() => process.exit(0), 15000)
})
