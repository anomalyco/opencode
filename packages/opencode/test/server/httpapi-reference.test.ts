import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import { Global } from "@opencode-ai/core/global"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("reference HttpApi", () => {
  test("lists presentation-safe references resolved in the server workspace", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: false,
        lsp: false,
        reference: {
          docs: "./docs",
          effect: { repository: "Effect-TS/effect", branch: "main" },
          bad: "not-a-repo",
        },
      },
    })

    const response = await Server.Default().app.request("/reference", {
      headers: { "x-opencode-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      {
        name: "docs",
        kind: "local",
        path: path.join(tmp.path, "docs"),
      },
      {
        name: "effect",
        kind: "git",
        repository: "Effect-TS/effect",
        path: path.join(Global.Path.repos, "github.com", "Effect-TS", "effect"),
        branch: "main",
      },
      {
        name: "bad",
        kind: "invalid",
        repository: "not-a-repo",
        message: "Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand",
      },
    ])
  })
})
