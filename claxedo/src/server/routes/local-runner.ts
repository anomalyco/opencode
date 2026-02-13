
/**
 * Local OpenCode Runner
 *
 * Spawns the OpenCode server directly using Bun (Dev Mode).
 * Used when Config.SANDBOX_ENABLED is false AND Config.USE_RIVET_SANDBOX_AGENT_SERVER is false.
 *
 * IMPORTANT: We run `bun <file>` (not `bun run <file>`) to avoid Bun's script/bin
 * resolution which can delegate to Node.js via the bin/opencode shebang, triggering
 * a CJS-in-ESM error since packages/opencode has "type": "module".
 */
import { spawn, ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { Config } from "../../config/index.ts"
import path from "path"
import { fileURLToPath } from "url"

let subprocess: ChildProcess | null = null

// Resolve relative to this file, not cwd() — works regardless of where the gateway is started from.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = path.resolve(__dirname, "../../../../packages/opencode")

export async function spawnLocalOpenCode() {
  if (subprocess) return

  const entryPoint = path.join(PACKAGE_DIR, "src/index.ts")

  if (!existsSync(entryPoint)) {
    throw new Error(`[LocalRunner] Entry point not found: ${entryPoint}`)
  }

  console.log(`[LocalRunner] Spawning OpenCode from: ${entryPoint}`)

  try {
    // Use `bun <file>` (not `bun run`) to bypass script/bin resolution.
    subprocess = spawn("bun", [entryPoint, "serve", "--port", Config.OPENCODE_PORT.toString(), "--hostname", "127.0.0.1"], {
      stdio: "inherit",
      cwd: PACKAGE_DIR,
      env: {
        ...process.env,
        OPENCODE_PORT: Config.OPENCODE_PORT.toString()
      }
    })

    console.log(`[LocalRunner] Started OpenCode PID: ${subprocess.pid}`)

    subprocess.on("error", (err) => {
        console.error("[LocalRunner] Subprocess error:", err)
        subprocess = null
    })

    subprocess.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[LocalRunner] OpenCode exited with code ${code}`)
      } else if (signal) {
        console.warn(`[LocalRunner] OpenCode killed by signal ${signal}`)
      }
      subprocess = null
    })

    // Safety: kill it when this process exits
    process.on("exit", () => {
        killLocalOpenCode()
    })

  } catch (err) {
    console.error("[LocalRunner] Failed to spawn OpenCode:", err)
    throw err
  }
}

export async function killLocalOpenCode() {
  if (subprocess) {
    console.log("[LocalRunner] Killing OpenCode subprocess...")
    subprocess.kill()
    subprocess = null
  }
}
