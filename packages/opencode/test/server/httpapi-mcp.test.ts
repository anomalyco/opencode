import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { McpPaths } from "../../src/server/routes/instance/httpapi/mcp"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string) {
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${route}`, {
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

describe("mcp HttpApi", () => {
  test("serves status endpoint", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const response = await request(McpPaths.status, tmp.path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ demo: { status: "disabled" } })
  })
})
