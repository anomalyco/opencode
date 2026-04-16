/**
 * Black-box end-to-end proof for the Vercel sandbox backend.
 *
 * Spawns `opencode serve` as a subprocess, drives it through the public
 * `@opencode-ai/sdk` HTTP client, and asserts things a real integrator
 * would observe: a fresh session has zero messages, the bash tool
 * returns Linux + /vercel/sandbox, filesystem writes survive across
 * prompts in the same tenant. No in-process tricks.
 *
 * Prerequisites:
 *   - An opencode binary on PATH, built from THIS branch (not the
 *     released one; it needs the workspace substrate dispatch).
 *     From packages/opencode: `bun run build --single` puts one at
 *     dist/opencode-<platform>-<arch>/bin/opencode — prepend that
 *     dir to PATH.
 *   - VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID / VERCEL_SANDBOX_IMAGE_ID
 *     in the env (or put them in a .env and source it).
 *   - ANTHROPIC_API_KEY only if you override OC_TEST_PROVIDER=anthropic.
 *     By default the tests use opencode's built-in free models so the
 *     whole thing runs with just the vercel creds.
 *
 * Running (from packages/opencode):
 *
 *   # Everything, real sandbox, real LLM (~40–90 s):
 *   OPENCODE_WORKSPACE_BACKEND=vercel bun test script/vercel-proof.test.ts
 *
 *   # Infra-only, no LLM (~5 s):
 *   OPENCODE_WORKSPACE_BACKEND=vercel bun test script/vercel-proof.test.ts -t "A.0"
 *
 *   # One LLM scenario:
 *   OPENCODE_WORKSPACE_BACKEND=vercel bun test script/vercel-proof.test.ts -t "A.1"
 *
 *   # A single sub-step:
 *   OPENCODE_WORKSPACE_BACKEND=vercel bun test script/vercel-proof.test.ts -t "A.1.3"
 *
 * The file skips itself when VERCEL_* is missing (via `describe.skipIf`)
 * so it's safe to leave enabled in the normal `bun test` run.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type Subprocess } from "bun"
import * as NFS from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"

// ───────────────────────── env gating ─────────────────────────

const HAS_VERCEL =
  !!process.env["VERCEL_TOKEN"] && !!process.env["VERCEL_TEAM_ID"] && !!process.env["VERCEL_PROJECT_ID"]

// LLM provider: opencode's built-in free models are always loaded
// and need no credentials. Good enough for "does the agent call the
// bash tool when asked" — we're not benchmarking reasoning quality.
// Switch to anthropic/claude-sonnet-4-6 if you need higher-quality
// multi-step reasoning in a specific scenario and have credits.
const LLM_PROVIDER_ID = process.env["OC_TEST_PROVIDER"] ?? "opencode"
const LLM_MODEL_ID = process.env["OC_TEST_MODEL"] ?? "gpt-5-nano"

// We always need a real opencode server. If VERCEL_* is missing we
// skip the whole file — bun:test's `describe.skipIf` handles this
// gracefully with a clear "skipped" marker in the report.
const skipAll = !HAS_VERCEL
// Free models are always available inside opencode, so LLM tests
// never skip on credentials. Override via OC_TEST_PROVIDER /
// OC_TEST_MODEL if you want a different provider.
const skipLLM = false

// ───────────────────────── types ─────────────────────────

type Client = ReturnType<typeof createOpencodeClient>

interface Server {
  readonly baseUrl: string
  readonly client: Client
  readonly stop: () => Promise<void>
}

interface ToolPart {
  readonly tool: string
  readonly status: string
  readonly output: string
  readonly metadata: Record<string, unknown>
  readonly input: Record<string, unknown>
}

interface Snapshot {
  readonly assistantText: string
  readonly toolParts: ToolPart[]
  readonly assistantCount: number
}

// ───────────────────────── subprocess ─────────────────────────

const pipeLines = async (stream: ReadableStream<Uint8Array>, prefix: string) => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line.trim()) console.log(`${prefix} ${line}`)
      }
    }
  } catch {
    /* stream closed */
  }
}

const randomPort = () => 4100 + Math.floor(Math.random() * 500)

async function waitForServer(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/doc`)
      if (res.status < 500) return
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`opencode server did not become ready at ${baseUrl}`)
}

async function spawnServer(envOverrides: Record<string, string> = {}): Promise<Server> {
  const opencodeBin = Bun.which("opencode")
  if (!opencodeBin) throw new Error("opencode binary not on PATH")

  const port = randomPort()
  const baseUrl = `http://127.0.0.1:${port}`

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OPENCODE_WORKSPACE_BACKEND: "vercel",
    OPENCODE_PERMISSION: JSON.stringify({
      edit: "allow",
      bash: "allow",
      write: "allow",
      read: "allow",
      external_directory: "allow",
    }),
    ...envOverrides,
  }

  const proc: Subprocess = spawn({
    cmd: [opencodeBin, "serve", "--port", String(port), "--hostname", "127.0.0.1"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  pipeLines(proc.stdout as ReadableStream<Uint8Array>, "[opencode.out]").catch(() => {})
  pipeLines(proc.stderr as ReadableStream<Uint8Array>, "[opencode.err]").catch(() => {})

  try {
    await waitForServer(baseUrl)
  } catch (err) {
    try {
      proc.kill()
    } catch {}
    throw err
  }

  const client = createOpencodeClient({ baseUrl } as any)
  return {
    baseUrl,
    client,
    stop: async () => {
      try {
        proc.kill()
      } catch {}
    },
  }
}

// ───────────────────────── session helpers ─────────────────────────

async function makeTenant(slug: string): Promise<string> {
  const dir = await NFS.mkdtemp(path.join(os.tmpdir(), `oc-proof-${slug}-${Date.now()}-`))
  return await NFS.realpath(dir)
}

async function createSession(client: Client, directory: string, title: string): Promise<string> {
  const res = await (client.session as any).create({
    query: { directory },
    body: { title },
    throwOnError: true,
  })
  return res.data.id as string
}

async function sendPrompt(
  client: Client,
  directory: string,
  sessionID: string,
  text: string,
): Promise<void> {
  await (client.session as any).promptAsync({
    query: { directory },
    path: { id: sessionID },
    body: {
      model: { providerID: LLM_PROVIDER_ID, modelID: LLM_MODEL_ID },
      agent: "build",
      parts: [{ type: "text", text }],
    },
    throwOnError: true,
  })
}

async function fetchMessages(client: Client, directory: string, sessionID: string): Promise<any[]> {
  const res = await (client.session as any).messages({
    query: { directory },
    path: { id: sessionID },
  })
  return res.data as any[]
}

function extractTurn(messages: any[], fromIndex: number): Snapshot {
  const toolParts: ToolPart[] = []
  let assistantText = ""
  let assistantCount = 0
  for (let i = fromIndex; i < messages.length; i++) {
    const m = messages[i]
    if (m?.info?.role !== "assistant") continue
    assistantCount++
    for (const p of m.parts ?? []) {
      if (p.type === "tool") {
        toolParts.push({
          tool: p.tool,
          status: p.state?.status ?? "unknown",
          output: typeof p.state?.output === "string" ? p.state.output : "",
          metadata: p.state?.metadata ?? {},
          input: p.state?.input ?? {},
        })
      }
      if (p.type === "text" && p.text) assistantText = p.text
    }
  }
  return { assistantText, toolParts, assistantCount }
}

/**
 * Poll until `until(snapshot)` returns true or the deadline elapses.
 * Returns the last snapshot — caller decides whether timeout is a
 * failure. `fromIndex` is the `messages.length` captured before the
 * prompt was sent, so we only look at the new turn.
 */
async function pollUntil(
  client: Client,
  directory: string,
  sessionID: string,
  fromIndex: number,
  until: (s: Snapshot) => boolean,
  timeoutMs: number,
): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs
  let last: Snapshot = { assistantText: "", toolParts: [], assistantCount: 0 }
  while (Date.now() < deadline) {
    const all = await fetchMessages(client, directory, sessionID)
    last = extractTurn(all, fromIndex)
    if (until(last)) return last
    await new Promise((r) => setTimeout(r, 500))
  }
  return last
}

function bashOutputOf(snapshot: Snapshot): string {
  const parts: string[] = []
  for (const t of snapshot.toolParts) {
    if (t.tool !== "bash") continue
    const metaStdout = typeof (t.metadata as any)?.stdout === "string" ? (t.metadata as any).stdout : ""
    parts.push(t.output + metaStdout)
  }
  return parts.join("\n")
}

// ───────────────────────── server lifecycle ─────────────────────────

let server: Server

beforeAll(async () => {
  if (skipAll) return
  const opencodeBin = Bun.which("opencode")
  if (!opencodeBin) {
    throw new Error(
      "opencode binary not on PATH — build and install it:\n" +
        "  cd ~/Projects/opencode/packages/opencode && bun run script/build.ts --single --skip-embed-web-ui\n" +
        "  ln -sf ~/Projects/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode ~/.local/bin/opencode",
    )
  }
  server = await spawnServer()
})

afterAll(async () => {
  if (server) await server.stop()
})

// ───────────────────────── scenarios ─────────────────────────

describe.skipIf(skipAll)("vercel-proof", () => {
  // ━━━━━━━━━━━ A.0  infra (no LLM)  ━━━━━━━━━━━
  describe("A.0 infra (no LLM)", () => {
    let directory: string
    let sessionID: string

    beforeAll(async () => {
      directory = await makeTenant("A0")
      sessionID = await createSession(server.client, directory, "A.0 infra")
    })

    test("A.0.1 opencode /doc responds", async () => {
      const res = await fetch(`${server.baseUrl}/doc`)
      expect(res.status).toBeLessThan(500)
    }, 5_000)

    test("A.0.2 session.create returned a ses_* id", () => {
      expect(sessionID).toMatch(/^ses_/)
    })

    test("A.0.3 fresh session has 0 messages", async () => {
      const messages = await fetchMessages(server.client, directory, sessionID)
      expect(messages.length).toBe(0)
    }, 5_000)
  })

  // ━━━━━━━━━━━ A.1  bash roundtrip (LLM)  ━━━━━━━━━━━
  describe.skipIf(skipLLM)("A.1 baseline: bash in vercel sandbox (LLM)", () => {
    let directory: string
    let sessionID: string
    let before: number

    beforeAll(async () => {
      directory = await makeTenant("A1")
      sessionID = await createSession(server.client, directory, "A.1 baseline")
      before = (await fetchMessages(server.client, directory, sessionID)).length
      await sendPrompt(
        server.client,
        directory,
        sessionID,
        "Call the bash tool with this command: `uname -a && pwd`. Do NOT set the workdir parameter — leave it out entirely so the tool uses its default working directory. After the tool completes, reply with one short sentence.",
      )
    }, 15_000)

    test("A.1.1 agent invokes the bash tool", async () => {
      const snap = await pollUntil(
        server.client,
        directory,
        sessionID,
        before,
        (s) => s.toolParts.some((t) => t.tool === "bash"),
        25_000,
      )
      expect(snap.toolParts.find((t) => t.tool === "bash")).toBeDefined()
    }, 28_000)

    test("A.1.2 bash tool completes with Linux + /vercel/sandbox", async () => {
      const snap = await pollUntil(
        server.client,
        directory,
        sessionID,
        before,
        (s) =>
          s.toolParts.some((t) => t.tool === "bash" && (t.status === "completed" || t.status === "error")),
        25_000,
      )
      const bash = snap.toolParts.find((t) => t.tool === "bash")
      expect(bash).toBeDefined()
      expect(bash!.status).toMatch(/completed|error/)
      const out = bashOutputOf(snap)
      expect(out).not.toContain("Darwin")
      expect(out).toContain("Linux")
      expect(out).toContain("/vercel/sandbox")
    }, 28_000)

    test("A.1.3 assistant text reply arrives", async () => {
      const snap = await pollUntil(
        server.client,
        directory,
        sessionID,
        before,
        (s) => s.assistantText.length > 0,
        25_000,
      )
      expect(snap.assistantText.length).toBeGreaterThan(0)
    }, 28_000)
  })

  // ━━━━━━━━━━━ B.1  sandbox filesystem state across prompts (LLM)  ━━━━━━━━━━━
  describe.skipIf(skipLLM)("B.1 filesystem state persists across prompts", () => {
    const tag = `b1-marker-${Date.now()}`
    let directory: string
    let sessionID: string
    let beforeFirst: number
    let beforeSecond: number

    beforeAll(async () => {
      directory = await makeTenant("B1")
      sessionID = await createSession(server.client, directory, "B.1 state")
      beforeFirst = (await fetchMessages(server.client, directory, sessionID)).length
      await sendPrompt(
        server.client,
        directory,
        sessionID,
        `Use the bash tool to run EXACTLY: \`echo ${tag} > /tmp/probe-b1.txt\`. Reply "done".`,
      )
    }, 15_000)

    test("B.1.1 first prompt (write) completes", async () => {
      const snap = await pollUntil(
        server.client,
        directory,
        sessionID,
        beforeFirst,
        (s) =>
          s.toolParts.some((t) => t.tool === "bash" && (t.status === "completed" || t.status === "error")) &&
          s.assistantText.length > 0,
        28_000,
      )
      expect(snap.toolParts.find((t) => t.tool === "bash")).toBeDefined()
      beforeSecond = (await fetchMessages(server.client, directory, sessionID)).length
      await sendPrompt(
        server.client,
        directory,
        sessionID,
        "Use the bash tool to run EXACTLY: `cat /tmp/probe-b1.txt`. Reply with just the file contents.",
      )
    }, 30_000)

    test("B.1.2 second prompt (read) contains the tag", async () => {
      const snap = await pollUntil(
        server.client,
        directory,
        sessionID,
        beforeSecond,
        (s) =>
          s.toolParts.some((t) => t.tool === "bash" && (t.status === "completed" || t.status === "error")) &&
          s.assistantText.length > 0,
        28_000,
      )
      const out = bashOutputOf(snap)
      expect(out).toContain(tag)
    }, 30_000)
  })
})
