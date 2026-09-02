import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const QUERY =
  "with recursive t(n) as (select 1 union all select n+1 from t where n < 15000) select n as n, '0123456789012345678901234567890123456789' as pad from t"
const ROOT = path.resolve(import.meta.dir, "../..")

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "opencode-stdout-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function spawn(stdout: "pipe"): Bun.Subprocess<"ignore", "pipe", "pipe">
function spawn(stdout: ReturnType<typeof Bun.file>): Bun.Subprocess<"ignore", ReturnType<typeof Bun.file>, "pipe">
function spawn(stdout: "pipe" | ReturnType<typeof Bun.file>) {
  const isolated = {
    OPENCODE_TEST_HOME: tmp,
    HOME: tmp,
    XDG_CONFIG_HOME: path.join(tmp, ".config"),
    XDG_DATA_HOME: path.join(tmp, ".local/share"),
    XDG_STATE_HOME: path.join(tmp, ".local/state"),
    XDG_CACHE_HOME: path.join(tmp, ".cache"),
    OPENCODE_CONFIG_CONTENT: "{}",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_AUTH_CONTENT: "{}",
  }
  return Bun.spawn([process.execPath, "src/index.ts", "db", "--format", "json", QUERY], {
    cwd: ROOT,
    stdout,
    stderr: "pipe",
    env: { ...process.env, ...isolated },
  })
}

// Delay the first read until the pipe fills so returning before stdout drains
// deterministically exposes truncated output.
test("large JSON output is complete when the reader is slow", async () => {
  const proc = spawn("pipe")
  await Bun.sleep(2000)
  const text = await new Response(proc.stdout).text()
  await proc.exited
  expect(proc.exitCode).toBe(0)
  expect(text.length).toBeGreaterThan(65536)
  expect(JSON.parse(text)).toHaveLength(15000)

  const file = path.join(tmp, "full.json")
  const ctl = spawn(Bun.file(file))
  await ctl.exited
  expect(text).toBe(await Bun.file(file).text())
}, 60_000)

test("exits cleanly when the reader goes away", async () => {
  const proc = spawn("pipe")
  const reader = proc.stdout.getReader()
  await reader.read()
  await reader.cancel()
  const code = await Promise.race([proc.exited, Bun.sleep(5000).then(() => "timeout")])
  expect(code).toBe(0)
  const err = await new Response(proc.stderr).text()
  expect(err).not.toMatch(/EPIPE|Unhandled/)
}, 60_000)
