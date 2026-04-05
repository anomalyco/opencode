import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

function forms(dir: string) {
  if (!/^[A-Za-z]:/.test(dir)) throw new Error("expected Windows path")
  const slash = dir.replace(/\\/g, "/")
  return [
    slash,
    slash.replace(/^([A-Za-z]):/, (_, x) => `/${x.toLowerCase()}`),
    dir.replace(/^([A-Za-z]):/, (_, x) => `${x.toLowerCase()}:`),
  ]
}

describe("Session directory normalization", () => {
  test("Session.list matches Windows directory variants", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "normalized-list" })

        for (const dir of forms(tmp.path)) {
          const ids = [...Session.list({ directory: dir })].map((item) => item.id)
          expect(ids).toContain(session.id)
        }
      },
    })
  })

  test("Session.listGlobal matches Windows directory variants", async () => {
    if (process.platform !== "win32") return

    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const session = await Instance.provide({
      directory: first.path,
      fn: async () => Session.create({ title: "normalized-global" }),
    })
    const other = await Instance.provide({
      directory: second.path,
      fn: async () => Session.create({ title: "other-global" }),
    })

    for (const dir of forms(first.path)) {
      const ids = [...Session.listGlobal({ directory: dir, limit: 200 })].map((item) => item.id)
      expect(ids).toContain(session.id)
      expect(ids).not.toContain(other.id)
    }
  })
})