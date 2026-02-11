/**
 * Terminal Zombie Bug Tests
 *
 * Tests for the bug where closed terminal tabs reappear after page reload.
 * Each test simulates a hypothesis for where stale PTY entries survive.
 *
 * Strategy: mock the SDK, persisted storage, and SolidJS context dependencies,
 * then exercise createTerminalSession directly. "Reload" is simulated by
 * creating a new session that reads from the same in-memory storage.
 */
import { describe, expect, test, beforeEach, mock } from "bun:test"
import { createRoot, createEffect } from "solid-js"

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

type Listener = (event: any) => void

function createMockSDK() {
  const listeners = new Map<string, Set<Listener>>()
  const serverPtys = new Map<string, { id: string; title: string; cwd: string }>()
  let nextId = 1

  return {
    url: "http://localhost:7860",
    directory: "/workspace",
    event: {
      on(type: string, fn: Listener) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(fn)
        return () => listeners.get(type)?.delete(fn)
      },
    },
    client: {
      pty: {
        async create(input: { title?: string; env?: Record<string, string> }) {
          const id = `pty-${nextId++}`
          const info = { id, title: input.title ?? `Terminal ${id}`, cwd: "/workspace" }
          serverPtys.set(id, info)
          // Emit pty.created SSE event (simulates server broadcast)
          emit("pty.created", { info })
          return { data: info }
        },
        async remove(input: { ptyID: string }) {
          const existed = serverPtys.delete(input.ptyID)
          if (existed) {
            emit("pty.deleted", { id: input.ptyID })
          }
        },
        async update(_input: any) {},
        async list() {
          return { data: Array.from(serverPtys.values()) }
        },
      },
    },
    // Test helpers
    _emit: emit,
    _serverPtys: serverPtys,
    _listeners: listeners,
  }

  function emit(type: string, properties: any) {
    const fns = listeners.get(type)
    if (!fns) return
    for (const fn of fns) fn({ type, properties })
  }
}

// In-memory storage that survives "reloads" (new createTerminalSession calls)
function createMockStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem(key: string) {
      return data.get(key) ?? null
    },
    setItem(key: string, value: string) {
      data.set(key, value)
    },
    removeItem(key: string) {
      data.delete(key)
    },
    clear() {
      data.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// Register mocks before importing the module under test
// ---------------------------------------------------------------------------

const storage = createMockStorage()

// Mock persisted() to use our in-memory storage instead of localStorage
mock.module("@opencode-ai/ui/context", () => ({
  createSimpleContext: (config: any) => ({ use: () => {}, provider: () => {} }),
}))

mock.module("@/context/sdk", () => ({
  useSDK: () => { throw new Error("useSDK called outside test") },
}))

mock.module("@/utils/persist", () => ({
  Persist: {
    workspace: (dir: string, key: string, legacy?: string[]) => ({
      storage: "test.dat",
      key: `workspace:${key}`,
      legacy,
    }),
    serverWorkspace: (url: string, dir: string, key: string, legacy?: string[]) => ({
      storage: "test.dat",
      key: `workspace:${key}`,
      legacy,
    }),
  },
  persisted: (_target: any, storeResult: any) => {
    const [state, setState] = storeResult
    const key = typeof _target === "string" ? _target : _target.key

    // Hydrate from storage on init (simulates page load)
    const raw = storage.getItem(key)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        // Use reconcile-like behavior: replace the store contents
        setState("all", parsed.all ?? [])
        if (parsed.active !== undefined) setState("active", parsed.active)
      } catch {}
    }

    // Wrap setState to persist on every mutation
    const persistingSet = (...args: any[]) => {
      ;(setState as any)(...args)
      // Read current state and persist
      const snapshot = JSON.parse(JSON.stringify({ all: state.all, active: state.active }))
      storage.setItem(key, JSON.stringify(snapshot))
    }

    return [state, persistingSet, null, () => true]
  },
}))

mock.module("@solidjs/router", () => ({
  useParams: () => ({ dir: "/workspace" }),
}))

mock.module("../components/terminal-recovery", () => ({
  clearInitialCommandMarker: () => {},
}))

// Now import the module under test
const { createTerminalSession } = await import("./terminal")
const { mergeCreatedTerminal } = await import("./terminal-shared")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tick() {
  return new Promise<void>((r) => setTimeout(r, 0))
}

function createSession(sdk: ReturnType<typeof createMockSDK>) {
  let session: ReturnType<typeof createTerminalSession>
  let dispose: () => void
  createRoot((d) => {
    dispose = d
    session = createTerminalSession(sdk as any, "/workspace")
  })
  return { session: session!, dispose: dispose! }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("terminal zombie bug", () => {
  beforeEach(() => {
    storage.clear()
  })

  describe("Hypothesis 2: close() races with create .then() callback", () => {
    test("closing a terminal before create .then() resolves should not re-add it", async () => {
      const sdk = createMockSDK()
      const { session, dispose } = createSession(sdk)

      // Create a terminal
      session.new()
      await tick()

      const all = session.all()
      expect(all).toHaveLength(1)
      const ptyId = all[0].id

      // Close the terminal
      await session.close(ptyId)
      await tick()

      expect(session.all()).toHaveLength(0)

      // Simulate "reload" — create new session reading from same storage
      dispose()
      const { session: session2, dispose: dispose2 } = createSession(sdk)

      // After reload, store should be empty — no zombie
      expect(session2.all()).toHaveLength(0)

      dispose2()
    })
  })

  describe("Hypothesis 3: tab close relies on close watcher which is empty after reload", () => {
    test("store.all should be empty after close() even without close watcher", async () => {
      const sdk = createMockSDK()
      const { session, dispose } = createSession(sdk)

      // Create two terminals (simulates "terminal and terminal inside it")
      session.new()
      await tick()
      session.new()
      await tick()

      expect(session.all()).toHaveLength(2)
      const ids = session.all().map((p) => p.id)

      // Close both
      await session.close(ids[0])
      await session.close(ids[1])
      await tick()

      expect(session.all()).toHaveLength(0)

      // Verify storage is clean
      const raw = storage.getItem("workspace:terminal")
      if (raw) {
        const parsed = JSON.parse(raw)
        expect(parsed.all).toHaveLength(0)
      }

      dispose()
    })

    test("after reload, closed terminals should not reappear in store.all", async () => {
      const sdk = createMockSDK()
      const { session, dispose } = createSession(sdk)

      // Create terminals
      session.new()
      await tick()
      session.new()
      await tick()
      expect(session.all()).toHaveLength(2)

      // Close all
      for (const pty of session.all()) {
        await session.close(pty.id)
      }
      await tick()
      expect(session.all()).toHaveLength(0)

      // "Reload" — dispose old, create new reading from same storage
      dispose()
      const { session: reloaded, dispose: dispose2 } = createSession(sdk)

      expect(reloaded.all()).toHaveLength(0)

      dispose2()
    })
  })

  describe("Hypothesis 4: stale store.all entries survive reload — no server reconciliation", () => {
    test("PTYs in store.all that don't exist on server should be pruned on load", async () => {
      const sdk = createMockSDK()

      // Manually seed storage with stale PTY entries (simulates corrupted state)
      storage.setItem(
        "workspace:terminal",
        JSON.stringify({
          all: [
            { id: "pty-stale-1", title: "Terminal 1", titleNumber: 1, cwd: "/workspace" },
            { id: "pty-stale-2", title: "Terminal 2", titleNumber: 2, cwd: "/workspace" },
            { id: "pty-stale-3", title: "Terminal 3", titleNumber: 3, cwd: "/workspace" },
          ],
          active: "pty-stale-1",
        }),
      )

      // Server has NO PTYs (was restarted, or these were deleted)
      expect(sdk._serverPtys.size).toBe(0)

      // Create session — simulates page load
      const { session, dispose } = createSession(sdk)

      // Wait for any async reconciliation
      await tick()
      await tick()

      // EXPECTED: stale entries should be pruned since server doesn't have them
      // THIS TEST SHOULD FAIL with current code (no reconciliation exists)
      expect(session.all()).toHaveLength(0)

      dispose()
    })

    test("PTYs in store.all that DO exist on server should be kept", async () => {
      const sdk = createMockSDK()

      // Create a real PTY on the server
      const info = { id: "pty-real", title: "Terminal 1", cwd: "/workspace" }
      sdk._serverPtys.set("pty-real", info)

      // Seed storage with both a real and stale PTY
      storage.setItem(
        "workspace:terminal",
        JSON.stringify({
          all: [
            { id: "pty-real", title: "Terminal 1", titleNumber: 1, cwd: "/workspace" },
            { id: "pty-ghost", title: "Terminal 2", titleNumber: 2, cwd: "/workspace" },
          ],
          active: "pty-real",
        }),
      )

      const { session, dispose } = createSession(sdk)
      await tick()
      await tick()

      // Should keep only the real PTY
      expect(session.all()).toHaveLength(1)
      expect(session.all()[0].id).toBe("pty-real")

      dispose()
    })
  })

  describe("Hypothesis: pty.exited event during SSE disconnect is lost", () => {
    test("PTY that exited while frontend was disconnected should not persist after reload", async () => {
      const sdk = createMockSDK()
      const { session, dispose } = createSession(sdk)

      // Create a terminal
      session.new()
      await tick()
      expect(session.all()).toHaveLength(1)
      const ptyId = session.all()[0].id

      // Simulate "disconnect" — unsubscribe all event listeners (page unload)
      dispose()

      // Server kills the PTY while frontend is disconnected
      sdk._serverPtys.delete(ptyId)
      // pty.exited event fires but nobody is listening
      sdk._emit("pty.exited", { id: ptyId, exitCode: 0 })

      // Storage still has the old PTY (persisted before disconnect)
      const raw = storage.getItem("workspace:terminal")
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw!)
      expect(parsed.all).toHaveLength(1) // stale entry

      // "Reload" — create new session
      const { session: reloaded, dispose: dispose2 } = createSession(sdk)
      await tick()
      await tick()

      // EXPECTED: stale entry should be cleaned up
      // THIS SHOULD FAIL with current code (no reconciliation on load)
      expect(reloaded.all()).toHaveLength(0)

      dispose2()
    })
  })
})
