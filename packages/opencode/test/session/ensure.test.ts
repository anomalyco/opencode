import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ensureSession } from "../../src/session/ensure"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

function active(path: string) {
  return Instance.provide({
    directory: path,
    fn: async () =>
      [...Session.list({ directory: path, roots: true })].filter((session) => !session.time?.archived),
  })
}

describe("ensureSession", () => {
  test("does not create a session when ensureSession is disabled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: ensureSession,
      fn: async () => {},
    })

    expect(await active(tmp.path)).toHaveLength(0)
  })

  test("does not create a session when ensureSession is false", async () => {
    await using tmp = await tmpdir({ config: { ensureSession: false } })
    await Instance.provide({
      directory: tmp.path,
      init: ensureSession,
      fn: async () => {},
    })

    expect(await active(tmp.path)).toHaveLength(0)
  })

  test("creates a root session when ensureSession is true", async () => {
    await using tmp = await tmpdir({ config: { ensureSession: true } })
    await Instance.provide({
      directory: tmp.path,
      init: ensureSession,
      fn: async () => {},
    })

    const sessions = await active(tmp.path)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.parentID).toBeUndefined()
  })

  test("does not create a duplicate when an active root session exists", async () => {
    await using tmp = await tmpdir({ config: { ensureSession: true } })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        await Session.create({})
        await ensureSession()
      },
      fn: async () => {},
    })

    const sessions = await active(tmp.path)
    expect(sessions).toHaveLength(1)
  })

  test("creates a session when only archived root sessions exist", async () => {
    await using tmp = await tmpdir({ config: { ensureSession: true } })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        const archived = await Session.create({})
        await Session.setArchived({ sessionID: archived.id, time: Date.now() })
        await ensureSession()
      },
      fn: async () => {},
    })

    const sessions = await active(tmp.path)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id).not.toBeUndefined()
  })
})
