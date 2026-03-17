import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionStart } from "../../src/session/start"
import { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.start edges", () => {
  test("trims appended context and drops blank entries", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        await SessionStart.clear(session.id)

        expect(await SessionStart.append(session.id, ["  foo  ", "", "   ", "\nbar\n"])).toEqual(["foo", "bar"])
        expect(await SessionStart.pending(session.id)).toEqual(["foo", "bar"])

        await Session.remove(session.id)
      },
    })
  })

  test("accumulates repeated resume triggers before the next turn", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        await SessionStart.clear(session.id)

        expect(await SessionStart.append(session.id, ["resume:one"])).toEqual(["resume:one"])
        expect(await SessionStart.append(session.id, ["resume:two"])).toEqual(["resume:one", "resume:two"])
        expect(await SessionStart.take(session.id)).toEqual(["resume:one", "resume:two"])
        expect(await SessionStart.pending(session.id)).toEqual([])

        await Session.remove(session.id)
      },
    })
  })

  test("throws when appending to a missing session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        try {
          await SessionStart.append(SessionID.make("ses_missing"), ["foo"])
          throw new Error("expected append to fail")
        } catch (err) {
          expect(err).toBeInstanceOf(Error)
          expect((err as Error).message).toBe("NotFoundError")
        }
      },
    })
  })
})
