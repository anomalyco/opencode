import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("config routes", () => {
  test("patch writes project config to opencode.json", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencode-directory": tmp.path,
          },
          body: JSON.stringify({
            model: "test/model",
          }),
        })

        expect(res.status).toBe(200)
      },
    })

    const file = path.join(tmp.path, "opencode.json")
    const cfg = await Bun.file(file).json()

    expect(cfg).toMatchObject({
      model: "test/model",
    })
    await expect(fs.stat(path.join(tmp.path, "config.json"))).rejects.toThrow()
  })

  test("patch updates existing .opencode config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const cfg = path.join(dir, ".opencode")
        await fs.mkdir(cfg, { recursive: true })
        await Bun.write(
          path.join(cfg, "opencode.json"),
          JSON.stringify({
            model: "base/model",
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencode-directory": tmp.path,
          },
          body: JSON.stringify({
            autoshare: true,
          }),
        })

        expect(res.status).toBe(200)
      },
    })

    const cfg = await Bun.file(path.join(tmp.path, ".opencode", "opencode.json")).json()

    expect(cfg).toMatchObject({
      model: "base/model",
      autoshare: true,
    })
    await expect(fs.stat(path.join(tmp.path, "opencode.json"))).rejects.toThrow()
    await expect(fs.stat(path.join(tmp.path, "config.json"))).rejects.toThrow()
  })
})
