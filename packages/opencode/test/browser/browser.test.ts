import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Browser } from "../../src/browser"
import { WithInstance } from "../../src/project/with-instance"
import { SessionID } from "../../src/session/schema"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
})

const id = SessionID.make("ses_12345678901234567890123456")
const sock = {
  readyState: 1,
  send: () => {},
  close: () => {},
}

const passive = async <T>(fn: () => Promise<T>) => {
  await using dir = await tmpdir({ git: true })
  await using run = await tmpdir()
  const bin = process.env.OPENCODE_AGENT_BROWSER_BIN
  const socket = process.env.AGENT_BROWSER_SOCKET_DIR
  process.env.OPENCODE_AGENT_BROWSER_BIN = path.join(dir.path, "missing-agent-browser")
  process.env.AGENT_BROWSER_SOCKET_DIR = run.path
  try {
    return await WithInstance.provide({
      directory: dir.path,
      fn,
    })
  } finally {
    if (bin === undefined) delete process.env.OPENCODE_AGENT_BROWSER_BIN
    else process.env.OPENCODE_AGENT_BROWSER_BIN = bin
    if (socket === undefined) delete process.env.AGENT_BROWSER_SOCKET_DIR
    else process.env.AGENT_BROWSER_SOCKET_DIR = socket
  }
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 20; i += 1) {
    if (ok()) return
    await Bun.sleep(25)
  }
  throw new Error("timed out")
}

describe("browser passive lookup", () => {
  test("tabs returns empty without invoking agent-browser", async () => {
    const tabs = await passive(() => Browser.tabs(id))

    expect(tabs).toEqual({ sessionID: id, tabs: [] })
  })

  test("status returns disabled without invoking agent-browser", async () => {
    const info = await passive(() => Browser.status(id))

    expect(info).toMatchObject({
      sessionID: id,
      enabled: false,
      connected: false,
      screencasting: false,
    })
  })

  test("observe waits without invoking agent-browser", async () => {
    const obs = await passive(() => Browser.observe(id))

    obs.onClose()
  })

  test("connect only attaches to a running agent-browser session", async () => {
    await expect(passive(() => Browser.connect(id, sock))).rejects.toThrow("agent-browser session is not running")
  })

  test("connect starts screencasting on existing stream", async () => {
    await using dir = await tmpdir({ git: true })
    await using run = await tmpdir()
    const got: string[] = []
    const sent: string[] = []
    const srv = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return
        return new Response("upgrade failed", { status: 400 })
      },
      websocket: {
        message(_ws, data) {
          got.push(String(data))
        },
      },
    })
    const socket = process.env.AGENT_BROWSER_SOCKET_DIR
    process.env.AGENT_BROWSER_SOCKET_DIR = run.path
    await Bun.write(path.join(run.path, `${id}.stream`), String(srv.port))
    await Bun.write(path.join(run.path, `${id}.pid`), String(process.pid))

    try {
      const conn = await WithInstance.provide({
        directory: dir.path,
        fn: () =>
          Browser.connect(id, {
            readyState: 1,
            send(data) {
              if (typeof data === "string") sent.push(data)
            },
            close: () => {},
          }),
      })
      await until(() => got.length > 0)
      conn.onClose()
    } finally {
      srv.stop(true)
      if (socket === undefined) delete process.env.AGENT_BROWSER_SOCKET_DIR
      else process.env.AGENT_BROWSER_SOCKET_DIR = socket
    }

    expect(JSON.parse(got[0]!)).toEqual({ type: "screencast_start" })
    expect(sent).toEqual([])
  })
})
