import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/instance"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return InstanceRoutes(websocket)
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("instance HttpApi", () => {
  test("serves path and VCS read endpoints through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "changed.txt"), "hello")

    const vcsDiff = new URL(`http://localhost${InstancePaths.vcsDiff}`)
    vcsDiff.searchParams.set("mode", "git")

    const [paths, vcs, diff] = await Promise.all([
      app().request(InstancePaths.path, { headers: { "x-opencode-directory": tmp.path } }),
      app().request(InstancePaths.vcs, { headers: { "x-opencode-directory": tmp.path } }),
      app().request(vcsDiff, { headers: { "x-opencode-directory": tmp.path } }),
    ])

    expect(paths.status).toBe(200)
    expect(await paths.json()).toMatchObject({ directory: tmp.path, worktree: tmp.path })

    expect(vcs.status).toBe(200)
    expect(await vcs.json()).toMatchObject({ branch: expect.any(String) })

    expect(diff.status).toBe(200)
    expect(await diff.json()).toContainEqual(
      expect.objectContaining({ file: "changed.txt", additions: 1, status: "added" }),
    )
  })
})
