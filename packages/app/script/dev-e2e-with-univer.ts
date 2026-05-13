import path from "node:path"
import { startUniverE2e } from "./e2e-testcontainers"

/**
 * Playwright webServer wrapper for tests that need Univer HTTP APIs.
 * Starts Testcontainers MinIO + local univer-compat, then runs Vite.
 */

const repo = path.resolve(import.meta.dir, "../../..")

async function main() {
  const rt = await startUniverE2e(repo)
  const dash = process.argv.indexOf("--")
  const viteArgs = dash >= 0 ? process.argv.slice(dash + 1) : []

  let cleaned = false
  const down = async () => {
    if (cleaned) return
    cleaned = true
    await rt.stop()
  }

  process.once("SIGINT", () => void down().then(() => process.exit(130)))
  process.once("SIGTERM", () => void down().then(() => process.exit(143)))

  const devTs = path.join(import.meta.dir, "dev.ts")
  const child = Bun.spawn({
    cmd: ["bun", devTs, ...viteArgs],
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, ...rt.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  const code = await child.exited
  await down()
  process.exit(code)
}

await main()
