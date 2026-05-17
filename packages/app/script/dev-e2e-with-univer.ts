import path from "node:path"
import { e2eEmitElapsed } from "../e2e/emit"
import { startUniverE2e } from "./e2e-testcontainers"

/**
 * Playwright webServer wrapper for tests that need Univer HTTP APIs.
 * Starts Testcontainers MinIO + local univer-compat, then runs Vite.
 */

const repo = path.resolve(import.meta.dir, "../../..")

function wsLog(msg: string, t0: number) {
  e2eEmitElapsed(t0, "webServer", msg)
}

async function main() {
  const t0 = Date.now()
  wsLog("dev-e2e-with-univer.ts (Playwright webServer) starting…", t0)
  wsLog("starting Univer Testcontainers (MinIO + mc + univer-compat) — same code as e2e-local univer leg; logs also under [WebServer] from DEBUG=testcontainers*", t0)
  const rt = await startUniverE2e(repo)
  wsLog(`Univer stack ready (compat ${rt.origin}). Next: spawn Vite via script/dev.ts`, t0)

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
  const base = process.env.PLAYWRIGHT_BASE_URL?.trim() || "(see Playwright baseURL)"
  wsLog(`spawning: bun ${path.basename(devTs)} ${viteArgs.join(" ")} — Playwright waits until ${base} returns 2xx`, t0)
  const child = Bun.spawn({
    cmd: ["bun", devTs, ...viteArgs],
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, ...rt.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const pid = child.pid
  wsLog(
    `Vite wrapper running (pid ${pid ?? "?"}). Playwright polls ${base} until HTTP 2xx — first cold Vite build often 30–120s; this line is normal silence.`,
    t0,
  )

  const tick = setInterval(() => {
    wsLog(`Vite still compiling / serving (pid ${pid ?? "?"}) — Playwright webServer url check pending…`, t0)
  }, 45_000)

  const code = await child.exited
  clearInterval(tick)
  wsLog(`Vite subprocess exited (${code}).`, t0)
  await down()
  process.exit(code)
}

await main()
