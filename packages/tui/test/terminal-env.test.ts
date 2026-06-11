import { expect, test } from "bun:test"
import path from "node:path"
import { TERMINAL_ENV_KEYS } from "../src/terminal-env"

// opentui auto-detects SSH sessions as remote and only reads terminal
// capability env vars that are forwarded explicitly. These tests spawn child
// processes with a controlled environment to verify that forwarding
// TERMINAL_ENV_KEYS keeps capability detection working over ssh (#31284).

const CHILD = `
import { createTestRenderer } from "@opentui/core/testing"
const forward = process.env.PROBE_FORWARD === "1"
const { renderer } = await createTestRenderer(
  forward ? { width: 40, height: 10, forwardEnvKeys: ${JSON.stringify(TERMINAL_ENV_KEYS)} } : { width: 40, height: 10 },
)
const internals = renderer as any
console.log("CAPS:" + JSON.stringify(internals.lib.getTerminalCapabilities(internals.rendererPtr)))
renderer.destroy()
process.exit(0)
`

const SESSION_KEYS = ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "MOSH_CONNECTION", ...TERMINAL_ENV_KEYS]

async function capabilities(overrides: Record<string, string>) {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of SESSION_KEYS) delete env[key]
  Object.assign(env, overrides)
  const proc = Bun.spawn([process.execPath, "--eval", CHILD], {
    cwd: path.join(import.meta.dir, ".."),
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect(code, stderr).toBe(0)
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .find((item) => item.startsWith("CAPS:"))
  expect(line, stdout + stderr).toBeDefined()
  return JSON.parse(line!.slice(5))
}

const TERM_ENV = { TERM: "xterm-256color", COLORTERM: "truecolor" }
const SSH_ENV = { ...TERM_ENV, SSH_CONNECTION: "192.0.2.1 54231 192.0.2.2 22", SSH_TTY: "/dev/pts/1" }

test("ssh session with forwarded env keys keeps color capabilities", async () => {
  const caps = await capabilities({ ...SSH_ENV, PROBE_FORWARD: "1" })
  expect(caps.remote).toBe(true)
  expect(caps.ansi256).toBe(true)
  expect(caps.rgb).toBe(true)
})

test("ssh session with forwarded env keys detects tmux", async () => {
  const caps = await capabilities({
    ...SSH_ENV,
    PROBE_FORWARD: "1",
    TMUX: "/tmp/tmux-1000/default,12345,0",
  })
  expect(caps.multiplexer).toBe("tmux")
  expect(caps.unicode).toBe("wcwidth")
})

test("local session keeps local capability detection", async () => {
  const caps = await capabilities({ ...TERM_ENV, PROBE_FORWARD: "1" })
  expect(caps.remote).toBe(false)
  expect(caps.ansi256).toBe(true)
  expect(caps.rgb).toBe(true)
})

// Canary for the upstream behavior this works around. When this starts
// failing, opentui reads the environment over ssh again and forwarding may be
// dropped.
test("ssh session without forwarded env keys hits the capability floor", async () => {
  const caps = await capabilities(SSH_ENV)
  expect(caps.remote).toBe(true)
  expect(caps.ansi256).toBe(false)
  expect(caps.rgb).toBe(false)
})
