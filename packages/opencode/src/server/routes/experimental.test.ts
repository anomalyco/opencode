import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { Instance } from "@/project/instance"
import { ProjectID } from "@/project/schema"
import { ExperimentalRoutes } from "./experimental"

describe("ExperimentalRoutes", () => {
  let dir = ""

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "opencode-experimental-"))
    ExperimentalRoutes.reset()
    await Instance.reload({
      directory: dir,
      worktree: dir,
      project: {
        id: ProjectID.global,
        worktree: dir,
        sandboxes: [dir],
        time: {
          created: 1,
          updated: 1,
        },
      },
    })
  })

  afterEach(async () => {
    await Instance.disposeAll()
    ExperimentalRoutes.reset()
    await rm(dir, { recursive: true, force: true })
  })

  test("POST /design persists the latest design state", async () => {
    const app = ExperimentalRoutes()
    const body = {
      selectedElement: {
        tagName: "button",
        domPath: "body > button",
      },
      timestamp: 123,
    }

    const res = await Instance.provide({
      directory: dir,
      fn: () =>
        app.request("http://localhost/design", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)
    expect(await Bun.file(path.join(dir, ".opencode", ".design-state.json")).json()).toEqual(body)
  })

  test("GET /design returns the latest command payload", async () => {
    const app = ExperimentalRoutes()
    const body = {
      type: "select",
      selector: ".hero",
      timestamp: 456,
    }

    await Bun.write(path.join(dir, ".opencode", ".design-command.json"), JSON.stringify(body))

    const res = await Instance.provide({
      directory: dir,
      fn: () => app.request("http://localhost/design"),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(body)
  })
})
