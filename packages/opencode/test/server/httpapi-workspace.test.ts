import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { WorkspacePaths } from "../../src/server/routes/instance/httpapi/workspace"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(path: string, directory: string) {
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${path}`, {
      headers: {
        "x-opencode-directory": directory,
      },
    }),
    context,
  )
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("workspace HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })

    const [adaptors, workspaces, status] = await Promise.all([
      request(WorkspacePaths.adaptors, tmp.path),
      request(WorkspacePaths.list, tmp.path),
      request(WorkspacePaths.status, tmp.path),
    ])

    expect(adaptors.status).toBe(200)
    expect(await adaptors.json()).toEqual([
      {
        type: "worktree",
        name: "Worktree",
        description: "Create a git worktree",
      },
    ])

    expect(workspaces.status).toBe(200)
    expect(await workspaces.json()).toEqual([])

    expect(status.status).toBe(200)
    expect(await status.json()).toEqual([])
  })
})
