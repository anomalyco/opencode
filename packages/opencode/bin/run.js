import { spawn } from "child_process"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const command = process.platform === "win32" ? "opencode.cmd" : "opencode"
const commandPath = path.join(__dirname, command)
const args = process.argv.slice(2)

const child = spawn(commandPath, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
})

child.on("exit", (code) => {
  process.exit(code === null ? 1 : code)
})

child.on("error", (err) => {
  console.error(`Failed to start subprocess: ${err}`)
  process.exit(1)
})
