import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type WS = {
  readyState: number
  sent: string[]
  closeCount: number
  throwSend?: boolean
  send: (data: string) => void
  close: () => void
}

type Proc = {
  pid: number
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (input: { exitCode: number }) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  writes: string[]
  resizes: Array<{ cols: number; rows: number }>
  killCount: number
  emitData: (data: string) => void
  emitExit: (exitCode: number) => void
}

const events: Array<{ name: string; payload: unknown }> = []
const spawned: Proc[] = []
let ids = ["pty-1", "pty-2", "pty-3"]
let nextID = 1
let Pty: typeof import("./index").Pty
const root = path.join(os.tmpdir(), `opencode-pty-int-${Date.now()}-${Math.random().toString(36).slice(2)}`)

const ws = (input?: { readyState?: number; throwSend?: boolean }): WS => {
  const out: WS = {
    readyState: input?.readyState ?? 1,
    sent: [],
    closeCount: 0,
    throwSend: input?.throwSend,
    send(data) {
      if (out.throwSend) throw new Error("send failed")
      out.sent.push(data)
    },
    close() {
      out.readyState = 3
      out.closeCount += 1
    },
  }
  return out
}

const proc = (): Proc => {
  let onData = (_: string) => {}
  let onExit = (_: { exitCode: number }) => {}
  return {
    pid: 321,
    writes: [],
    resizes: [],
    killCount: 0,
    onData(cb) {
      onData = cb
    },
    onExit(cb) {
      onExit = cb
    },
    write(data) {
      this.writes.push(data)
    },
    resize(cols, rows) {
      this.resizes.push({ cols, rows })
    },
    kill() {
      this.killCount += 1
    },
    emitData(data) {
      onData(data)
    },
    emitExit(exitCode) {
      onExit({ exitCode })
    },
  }
}

beforeAll(async () => {
  process.env.OPENCODE_PTY_HISTORY_DIR = root
  mock.module("@/bus/bus-event", () => ({
    BusEvent: {
      define: (name: string) => name,
    },
  }))
  mock.module("@/bus", () => ({
    Bus: {
      publish: (name: string, payload: unknown) => {
        events.push({ name, payload })
      },
    },
  }))
  mock.module("../id/id", async () => {
    const z = await import("zod")
    return {
      Identifier: {
        create: () => ids.shift() ?? "pty-fallback",
        schema: () => z.string(),
      },
    }
  })
  mock.module("../util/log", () => ({
    Log: {
      create: () => ({ info() {}, warn() {}, error() {} }),
    },
  }))
  mock.module("../project/instance", () => {
    const sessions = new Map<string, unknown>()
    return {
      Instance: {
        directory: "/tmp/ws",
        state: () => () => sessions,
      },
    }
  })
  mock.module("@opencode-ai/util/lazy", () => ({
    lazy: <T,>(fn: () => Promise<T>) => {
      let value: Promise<T> | undefined
      return () => {
        value ||= fn()
        return value
      }
    },
  }))
  mock.module("@/shell/shell", () => ({
    Shell: { preferred: () => "/bin/sh" },
  }))
  mock.module("@/plugin", () => ({
    Plugin: {
      trigger: async () => ({ env: {} }),
    },
  }))
  mock.module("bun-pty", () => ({
    spawn: () => {
      const p = proc()
      spawned.push(p)
      return p
    },
  }))
  const mod = await import("./index")
  Pty = mod.Pty
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => {})
})

beforeEach(async () => {
  for (const session of Pty.list()) {
    await Pty.remove(session.id)
  }
  events.length = 0
  spawned.length = 0
  ids = [`pty-${nextID++}`, `pty-${nextID++}`, `pty-${nextID++}`]
})

describe("pty integration", () => {
  test("stream_does_not_complete_on_exit", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })
    const a = ws()
    Pty.connect(created.id, a as never)

    spawned[0]?.emitData("hello")
    spawned[0]?.emitExit(0)
    spawned[0]?.emitData("after")

    expect(a.sent).toEqual(["hello"])
    expect(a.closeCount).toBe(1)
  })

  test("stream_does_not_complete_on_disconnect", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })
    const a = ws()
    const link = Pty.connect(created.id, a as never)
    link?.onClose()

    spawned[0]?.emitData("buffered")
    const b = ws()
    Pty.connect(created.id, b as never)

    expect(a.sent).toEqual([])
    expect(a.closeCount).toBe(0)
    expect(b.sent.join("")).toBe("buffered")
  })

  test("stream_does_not_complete_on_error", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })
    const broken = ws({ throwSend: true })
    Pty.connect(created.id, broken as never)

    spawned[0]?.emitData("x")
    spawned[0]?.emitData("y")

    const next = ws()
    Pty.connect(created.id, next as never)

    expect(broken.closeCount).toBe(1)
    expect(next.sent.join("")).toBe("xy")
  })

  test("unsubscribe_cleans_all_listeners", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })
    const a = ws()
    const b = ws()
    const one = Pty.connect(created.id, a as never)
    const two = Pty.connect(created.id, b as never)

    one?.onClose()
    two?.onClose()
    spawned[0]?.emitData("tail")

    expect(a.sent).toEqual([])
    expect(b.sent).toEqual([])
  })

  test("reconnect_replays_history_then_live_without_duplicate", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })

    spawned[0]?.emitData("hist")
    const a = ws()
    const one = Pty.connect(created.id, a as never)
    one?.onClose()

    spawned[0]?.emitData("mid")
    const b = ws()
    Pty.connect(created.id, b as never)
    spawned[0]?.emitData("live")

    expect(a.sent.join("")).toBe("hist")
    expect(b.sent.join("")).toBe("histmidlive")
  })

  test("reconnect_during_high_output_preserves_order", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })

    const parts = Array.from({ length: 2000 }, (_, i) => `${i},`)
    const data = parts.join("")
    spawned[0]?.emitData(data)

    const a = ws()
    Pty.connect(created.id, a as never)

    expect(a.sent.join("")).toBe(data)
  })

  test("ws_send_failure_during_replay_does_not_corrupt_session", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })

    spawned[0]?.emitData("replay")

    const broken = ws({ throwSend: true })
    Pty.connect(created.id, broken as never)

    const next = ws()
    Pty.connect(created.id, next as never)

    expect(broken.closeCount).toBe(1)
    expect(next.sent.join("")).toBe("replay")
    const stream = events.filter((event) => event.name === "pty.stream")
    expect(stream).toHaveLength(1)
    expect((stream[0]?.payload as { id: string; kind: string; message?: string }).id).toBe(created.id)
    expect((stream[0]?.payload as { id: string; kind: string; message?: string }).kind).toBe("error")
    expect((stream[0]?.payload as { id: string; kind: string; message?: string }).message).toBe("replay_send_failed")
  })

  test("rapid_connect_disconnect_does_not_leak_subscribers", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })

    for (let i = 0; i < 100; i += 1) {
      const s = ws()
      const link = Pty.connect(created.id, s as never)
      link?.onClose()
    }

    spawned[0]?.emitData("final")
    const next = ws()
    Pty.connect(created.id, next as never)

    expect(next.sent.join("")).toBe("final")
  })

  test("remove_clears_replay_and_prevents_old_data_resurface", async () => {
    const reused = `pty-${nextID++}`
    ids = [reused, reused, `pty-${nextID++}`]

    const first = await Pty.create({ command: "/bin/sh", args: [] })
    spawned[0]?.emitData("old")
    await Pty.remove(first.id)

    const second = await Pty.create({ command: "/bin/sh", args: [] })
    const client = ws()
    Pty.connect(second.id, client as never)

    expect(client.sent.join("")).toBe("")
  })

  test("pty_exited_event_emitted_once", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })

    spawned[0]?.emitExit(2)
    spawned[0]?.emitExit(2)

    const exited = events.filter((event) => event.name === "pty.exited")
    expect(exited).toHaveLength(1)
    expect((exited[0]?.payload as { id: string }).id).toBe(created.id)
  })

  test("pty_deleted_event_emitted_once", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })

    await Pty.remove(created.id)
    await Pty.remove(created.id)

    const deleted = events.filter((event) => event.name === "pty.deleted")
    expect(deleted).toHaveLength(1)
  })

  test("write_before_ready_is_buffered_or_rejected_without_crash", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })
    Pty.write(created.id, "queued")
    expect(spawned[0]?.writes).toEqual([])

    const client = ws()
    Pty.connect(created.id, client as never)

    expect(spawned[0]?.writes).toEqual(["queued"])
  })

  test("connect_after_restore_applies_latest_cols_rows_before_live_input", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })
    Pty.resize(created.id, 100, 40)
    Pty.resize(created.id, 120, 50)

    const client = ws()
    Pty.connect(created.id, client as never)

    expect(spawned[0]?.resizes).toEqual([
      { cols: 100, rows: 40 },
      { cols: 120, rows: 50 },
    ])
  })

  test("remove_closes_all_clients_and_terminates_process_once", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })
    const a = ws()
    const b = ws()
    Pty.connect(created.id, a as never)
    Pty.connect(created.id, b as never)

    await Pty.remove(created.id)
    await Pty.remove(created.id)

    expect(a.closeCount).toBe(1)
    expect(b.closeCount).toBe(1)
  })

  test("disconnect_event_emitted_with_matching_id", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })
    const client = ws()
    const link = Pty.connect(created.id, client as never)

    link?.onClose()

    const stream = events.filter((event) => event.name === "pty.stream")
    expect(stream).toHaveLength(1)
    expect((stream[0]?.payload as { id: string; kind: string }).id).toBe(created.id)
    expect((stream[0]?.payload as { id: string; kind: string }).kind).toBe("disconnect")
  })
})
