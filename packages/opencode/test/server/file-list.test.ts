import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { workosSessionTestHeaders } from "../fixture/workos-session-cookie"
import { tmpdir } from "../fixture/fixture"

const wos = workosSessionTestHeaders()
const canHitApiWithWos = !("skip" in wos)

let prevWorkos: string | undefined

beforeAll(() => {
  if (!canHitApiWithWos) return
  prevWorkos = process.env["OPENCODE_WORKOS_ENABLED"]
  process.env["OPENCODE_WORKOS_ENABLED"] = "true"
})
afterAll(() => {
  if (prevWorkos === undefined) delete process.env["OPENCODE_WORKOS_ENABLED"]
  else process.env["OPENCODE_WORKOS_ENABLED"] = prevWorkos
})

describe("GET /file and File.list (no host project directory)", () => {
  if (canHitApiWithWos) {
    const { headers } = wos
    test("GET /file?path= and ?path=src return 200 and [] (real WorkOS session)", async () => {
      const app = Server.createApp({})
      for (const u of ["http://x/file?path=", "http://x/file?path=src"]) {
        const r = await app.request(u, { method: "GET", headers })
        expect(r.status).toBe(200)
        expect(await r.json()).toEqual([])
      }
    })

    test("GET /file/content returns 200 with empty text stub (no host fs)", async () => {
      const app = Server.createApp({})
      const r = await app.request("http://x/file/content?path=README.md", {
        method: "GET",
        headers,
      })
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ type: "text", content: "" })
    })
  }

  test("File.list is [] even with a real temp project", async () => {
    await using t = await tmpdir({
      init: async (dir) => {
        await Bun.write(`${dir}/visible.txt`, "x")
      },
    })
    await Instance.provide({
      directory: t.path,
      fn: async () => {
        expect(await File.list("")).toEqual([])
        expect(await File.list("x")).toEqual([])
      },
    })
  })
})
