import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type WS = {
  readyState: number
  sent: string[]
  closeCount: number
  send: (data: string) => void
  close: () => void
}

let Pty: typeof import("./index").Pty
const root = path.join(os.tmpdir(), `opencode-pty-subprocess-${Date.now()}-${Math.random().toString(36).slice(2)}`)

const ws = (): WS => {
  const out: WS = {
    readyState: 1,
    sent: [],
    closeCount: 0,
    send(data) {
      out.sent.push(data)
    },
    close() {
      out.readyState = 3
      out.closeCount += 1
    },
  }
  return out
}

async function waitFor(predicate: () => boolean, timeout = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("timed out waiting for PTY output")
}

beforeAll(async () => {
  process.env.OPENCODE_PTY_HISTORY_DIR = root
  mock.module("@/bus/bus-event", () => ({
    BusEvent: { define: (name: string) => name },
  }))
  mock.module("@/bus", () => ({
    Bus: { publish() {} },
  }))
  mock.module("../util/log", () => ({
    Log: {
      create: () => ({ info() {}, warn() {}, error() {} }),
    },
  }))
  mock.module("../project/instance", () => {
    const sessions = new Map<string, unknown>()
    return {
      Instance: {
        directory: process.cwd(),
        state: () => () => sessions,
      },
    }
  })
  mock.module("@/plugin", () => ({
    Plugin: { trigger: async () => ({ env: {} }) },
  }))
  const mod = await import("./index")
  Pty = mod.Pty
})

afterAll(async () => {
  for (const session of Pty.list()) {
    await Pty.remove(session.id)
  }
  await fs.rm(root, { recursive: true, force: true }).catch(() => {})
})

describe("pty real subprocess lifecycle", () => {
  test("create_connect_write_stream_remove_with_real_bun_pty", async () => {
    const created = await Pty.create({ command: "/bin/sh", args: [] })
    const client = ws()
    const link = Pty.connect(created.id, client as never)

    Pty.write(created.id, "echo subprocess-lifecycle-ok\n")
    await waitFor(() => client.sent.join("").includes("subprocess-lifecycle-ok"))

    expect(client.sent.join("")).toContain("subprocess-lifecycle-ok")
    link?.onClose()
    await Pty.remove(created.id)
  })
})
