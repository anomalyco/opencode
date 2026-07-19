import { describe, expect, test, mock, beforeEach, afterEach, beforeAll, afterAll } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import plugin from "../../../../../.opencode/plugin/synapse-coder-reporter"

// --- Save originals for restoration ---

const originalFetch = globalThis.fetch
const originalLog = console.log
const originalError = console.error
const originalSetInterval = globalThis.setInterval
const originalClearInterval = globalThis.clearInterval

// --- Mocks ---

let fetchDelay = 0
let fetchFailNext = false

const fetchMock = mock(async (_url: string, _init: any) => {
  if (fetchFailNext) {
    fetchFailNext = false
    throw new Error("network down")
  }
  if (fetchDelay > 0) await new Promise((r) => setTimeout(r, fetchDelay))
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", result: { content: [{ type: "text", text: "ok" }] } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
})

const logMock = mock((..._args: any[]) => {})
const errorMock = mock((..._args: any[]) => {})

// --- Real temp directory for queue file I/O (Bun.file/Bun.write cannot be mocked) ---

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-reporter-test-"))
fs.mkdirSync(path.join(tempDir, ".opencode"), { recursive: true })

// --- Mock PluginInput ---

const toastMock = mock(async (_opts: any) => ({}))

const mockInput = {
  client: {
    session: {
      get: mock(async () => ({ data: { modelID: "gpt-5", providerID: "openai" } })),
    },
    tui: {
      showToast: toastMock,
    },
  },
  project: { id: "test-project" },
  directory: tempDir,
  worktree: tempDir,
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost:3000"),
  $: {} as any,
} as any

// --- Helpers ---

function lastLogEntry(): any {
  const calls = logMock.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return JSON.parse(calls[calls.length - 1][0])
}

async function flushMicrotasks(ms = 15): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

function lastFetchBody(): any {
  const calls = fetchMock.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  const lastCall = calls[calls.length - 1] as [string, any]
  return JSON.parse(lastCall[1].body)
}

function lastFetchPayload(): any {
  return lastFetchBody().params.arguments
}

// --- Tests ---

describe("synapse-coder-reporter", () => {
  let hooks: any

  beforeAll(() => {
    globalThis.fetch = fetchMock as any
    console.log = logMock as any
    console.error = errorMock as any
    globalThis.setInterval = (() => 0) as any
    globalThis.clearInterval = (() => {}) as any
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    console.log = originalLog
    console.error = originalError
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  beforeEach(async () => {
    delete process.env.SYNAPSE_CODER_REPORTER_ENABLED
    delete process.env.SYNAPSE_CODER_STAGING_BEARER_TOKEN
    delete process.env.SYNAPSE_CODER_PENDING_WINDOW_MS
    fetchDelay = 0
    fetchFailNext = false
    fetchMock.mockClear()
    logMock.mockClear()
    errorMock.mockClear()
    toastMock.mockClear()
    toastMock.mockImplementation(async () => ({}))
    // Clean queue file and prompt marker so each test starts fresh
    try {
      fs.unlinkSync(path.join(tempDir, ".opencode", "synapse-coder-queue.json"))
    } catch {}
    try {
      fs.unlinkSync(path.join(tempDir, ".opencode", "synapse-coder-prompted"))
    } catch {}
    hooks = await plugin(mockInput)
  })

  afterEach(async () => {
    if (hooks?.dispose) {
      try {
        await hooks.dispose()
      } catch {}
    }
    await flushMicrotasks(5)
  })

  describe("language derivation", () => {
    test("derives typescript from .ts extension", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "Type error" }] } },
      )
      const entry = lastLogEntry()
      expect(entry.language).toBe("typescript")
    })

    test("derives python from .py extension", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.py", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "Type error" }] } },
      )
      expect(lastLogEntry().language).toBe("python")
    })

    test("derives go from .go extension", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.go", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "Type error" }] } },
      )
      expect(lastLogEntry().language).toBe("go")
    })

    test("derives text from unknown .xyz extension", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.xyz", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "Type error" }] } },
      )
      expect(lastLogEntry().language).toBe("text")
    })
  })

  describe("diagnostics detection", () => {
    test("detects correction from non-empty diagnostics array", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "Type error" }] } },
      )
      expect(logMock.mock.calls.length).toBeGreaterThan(0)
    })

    test("does not detect correction from empty diagnostics array", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [] } },
      )
      expect(logMock.mock.calls.length).toBe(0)
      expect(fetchMock.mock.calls.length).toBe(0)
    })

    test("detects correction from object-keyed diagnostics", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: { "/test/foo.ts": [{ message: "error" }] } } },
      )
      expect(logMock.mock.calls.length).toBeGreaterThan(0)
    })

    test("does not detect correction when metadata is undefined", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: undefined },
      )
      expect(logMock.mock.calls.length).toBe(0)
      expect(fetchMock.mock.calls.length).toBe(0)
    })

    test("does not detect correction from empty metadata object", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: {} },
      )
      expect(logMock.mock.calls.length).toBe(0)
      expect(fetchMock.mock.calls.length).toBe(0)
    })
  })

  describe("tool filtering", () => {
    const diagMeta = { diagnostics: [{ message: "err" }] }

    test("processes edit tool with diagnostics", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: diagMeta },
      )
      expect(logMock.mock.calls.length).toBeGreaterThan(0)
    })

    test("processes write tool with diagnostics", async () => {
      await hooks["tool.execute.after"](
        { tool: "write", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", content: "x" } },
        { title: "t", output: "o", metadata: diagMeta },
      )
      expect(logMock.mock.calls.length).toBeGreaterThan(0)
    })

    test("processes apply_patch tool with diagnostics", async () => {
      await hooks["tool.execute.after"](
        { tool: "apply_patch", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", patchText: "@@ @@" } },
        { title: "t", output: "o", metadata: diagMeta },
      )
      expect(logMock.mock.calls.length).toBeGreaterThan(0)
    })

    test("ignores bash tool even with diagnostics", async () => {
      await hooks["tool.execute.after"](
        { tool: "bash", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts" } },
        { title: "t", output: "o", metadata: diagMeta },
      )
      expect(logMock.mock.calls.length).toBe(0)
      expect(fetchMock.mock.calls.length).toBe(0)
    })
  })

  describe("correction pairing", () => {
    beforeEach(() => {
      process.env.SYNAPSE_CODER_REPORTER_ENABLED = "true"
      process.env.SYNAPSE_CODER_STAGING_BEARER_TOKEN = "test-token"
    })

    async function failThenFix(tool: string, originalArgs: any, fixedArgs: any, filePath = "/test/foo.ts") {
      await hooks["tool.execute.after"](
        { tool, sessionID: "s1", callID: "c1", args: { filePath, ...originalArgs } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "err" }] } },
      )
      await hooks["tool.execute.after"](
        { tool, sessionID: "s1", callID: "c2", args: { filePath, ...fixedArgs } },
        { title: "t", output: "o", metadata: { diagnostics: [] } },
      )
      await flushMicrotasks()
    }

    test("reports original from failing edit and corrected from fixing edit", async () => {
      await failThenFix("edit", { newString: "const x = 1" }, { newString: "const x = 2" })
      expect(lastFetchPayload().original).toBe("const x = 1")
      expect(lastFetchPayload().corrected).toBe("const x = 2")
      expect(lastFetchPayload().tool).toBe("edit")
    })

    test("pairs write tool content", async () => {
      await failThenFix("write", { content: "broken" }, { content: "fixed" })
      expect(lastFetchPayload().original).toBe("broken")
      expect(lastFetchPayload().corrected).toBe("fixed")
    })

    test("pairs apply_patch patchText", async () => {
      await failThenFix("apply_patch", { patchText: "@@ bad @@" }, { patchText: "@@ good @@" })
      expect(lastFetchPayload().original).toBe("@@ bad @@")
      expect(lastFetchPayload().corrected).toBe("@@ good @@")
    })

    test("does not report on diagnostics alone (one-sided held)", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "err" }] } },
      )
      await flushMicrotasks()
      expect(fetchMock.mock.calls.length).toBe(0)
      expect(lastLogEntry().reason).toBe("awaiting_fix")
    })

    test("does not report when corrected equals original", async () => {
      await failThenFix("edit", { newString: "same" }, { newString: "same" })
      expect(fetchMock.mock.calls.length).toBe(0)
    })

    test("does not pair a follow-up edit to a different file", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "err" }] } },
      )
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c2", args: { filePath: "/test/bar.ts", newString: "y" } },
        { title: "t", output: "o", metadata: { diagnostics: [] } },
      )
      await flushMicrotasks()
      expect(fetchMock.mock.calls.length).toBe(0)
    })

    test("drops pending after the pairing window expires", async () => {
      process.env.SYNAPSE_CODER_PENDING_WINDOW_MS = "1"
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "err" }] } },
      )
      await flushMicrotasks(10)
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c2", args: { filePath: "/test/foo.ts", newString: "y" } },
        { title: "t", output: "o", metadata: { diagnostics: [] } },
      )
      await flushMicrotasks()
      expect(fetchMock.mock.calls.length).toBe(0)
      expect(lastLogEntry().event).toBe("synapse_correction_dropped")
    })

    test("queues the report when synapse is unreachable", async () => {
      fetchFailNext = true
      await failThenFix("edit", { newString: "bad" }, { newString: "good" })
      await flushMicrotasks(30)
      const queue = JSON.parse(fs.readFileSync(path.join(tempDir, ".opencode", "synapse-coder-queue.json"), "utf8"))
      expect(queue.length).toBe(1)
      expect(queue[0].original).toBe("bad")
      expect(queue[0].corrected).toBe("good")
    })
  })

  describe("opt-in gate", () => {
    test("logs reported=false and does not call fetch when opt-in disabled", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "err" }] } },
      )
      await flushMicrotasks()

      expect(logMock.mock.calls.length).toBeGreaterThan(0)
      const entry = lastLogEntry()
      expect(entry.reported).toBe(false)
      expect(entry.reason).toBe("opt_in_disabled")
      expect(fetchMock.mock.calls.length).toBe(0)
    })

    test("calls fetch when opt-in enabled and token set", async () => {
      process.env.SYNAPSE_CODER_REPORTER_ENABLED = "true"
      process.env.SYNAPSE_CODER_STAGING_BEARER_TOKEN = "test-token"

      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "bad" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "err" }] } },
      )
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c2", args: { filePath: "/test/foo.ts", newString: "good" } },
        { title: "t", output: "o", metadata: { diagnostics: [] } },
      )
      await flushMicrotasks()

      expect(fetchMock.mock.calls.length).toBeGreaterThan(0)
      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, any]
      expect(lastCall[1].headers.Authorization).toBe("Bearer test-token")
    })
  })

  describe("model tracking", () => {
    test("attaches session model to the report payload", async () => {
      process.env.SYNAPSE_CODER_REPORTER_ENABLED = "true"
      process.env.SYNAPSE_CODER_STAGING_BEARER_TOKEN = "test-token"

      await hooks["chat.message"](
        { sessionID: "s1", model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" } },
        { message: {}, parts: [] },
      )

      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "bad" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "err" }] } },
      )
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c2", args: { filePath: "/test/foo.ts", newString: "good" } },
        { title: "t", output: "o", metadata: { diagnostics: [] } },
      )
      await flushMicrotasks()

      expect(lastFetchPayload().model).toBe("anthropic/claude-sonnet-4-5")
      expect(lastFetchPayload().reporterModel).toBe("anthropic/claude-sonnet-4-5")
    })
  })

  describe("first-use opt-in prompt", () => {
    const diagMeta = { diagnostics: [{ message: "err" }] }

    test("shows toast once on first disabled correction and writes marker", async () => {
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: diagMeta },
      )
      await flushMicrotasks()
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c2", args: { filePath: "/test/foo.ts", newString: "y" } },
        { title: "t", output: "o", metadata: diagMeta },
      )
      await flushMicrotasks()

      expect(toastMock.mock.calls.length).toBe(1)
      const body = (toastMock.mock.calls[0] as [any])[0].body
      expect(body.variant).toBe("info")
      expect(body.message).toContain("SYNAPSE_CODER_REPORTER_ENABLED")
      expect(fs.existsSync(path.join(tempDir, ".opencode", "synapse-coder-prompted"))).toBe(true)
    })

    test("does not show toast when opt-in enabled", async () => {
      process.env.SYNAPSE_CODER_REPORTER_ENABLED = "true"
      process.env.SYNAPSE_CODER_STAGING_BEARER_TOKEN = "test-token"

      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: diagMeta },
      )
      await flushMicrotasks()

      expect(toastMock.mock.calls.length).toBe(0)
    })

    test("skips prompt and writes no marker when headless (showToast fails)", async () => {
      toastMock.mockImplementation(async () => {
        throw new Error("no tui")
      })

      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "x" } },
        { title: "t", output: "o", metadata: diagMeta },
      )
      await flushMicrotasks()

      expect(fs.existsSync(path.join(tempDir, ".opencode", "synapse-coder-prompted"))).toBe(false)
      expect(lastLogEntry().reason).toBe("opt_in_disabled")
    })
  })

  describe("fire-and-forget", () => {
    test("tool.execute.after hook returns before fetch resolves", async () => {
      process.env.SYNAPSE_CODER_REPORTER_ENABLED = "true"
      process.env.SYNAPSE_CODER_STAGING_BEARER_TOKEN = "test-token"

      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/test/foo.ts", newString: "bad" } },
        { title: "t", output: "o", metadata: { diagnostics: [{ message: "err" }] } },
      )

      fetchDelay = 500
      const start = Date.now()
      await hooks["tool.execute.after"](
        { tool: "edit", sessionID: "s1", callID: "c2", args: { filePath: "/test/foo.ts", newString: "good" } },
        { title: "t", output: "o", metadata: { diagnostics: [] } },
      )
      const elapsed = Date.now() - start

      // Hook should return well before the 500ms fetch delay
      expect(elapsed).toBeLessThan(200)

      // Wait for microtasks to flush so fetch is initiated
      await flushMicrotasks(20)
      expect(fetchMock.mock.calls.length).toBeGreaterThan(0)

      // Wait for the slow fetch to complete so no dangling promises remain
      await flushMicrotasks(550)
    })
  })
})
