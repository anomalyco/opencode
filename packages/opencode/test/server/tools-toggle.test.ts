import { describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("tools routes", () => {
  test("POST /tools/:name/toggle flips disabled state", async () => {
    const app = Server.App()

    const firstToggle = await app.request("/tools/bash/toggle", {
      method: "POST",
    })
    expect(firstToggle.status).toBe(200)
    const firstBody = (await firstToggle.json()) as { disabled: boolean }

    const secondToggle = await app.request("/tools/bash/toggle", {
      method: "POST",
    })
    expect(secondToggle.status).toBe(200)
    const secondBody = (await secondToggle.json()) as { disabled: boolean }
    expect(secondBody.disabled).not.toBe(firstBody.disabled)

    const thirdToggle = await app.request("/tools/bash/toggle", {
      method: "POST",
    })
    expect(thirdToggle.status).toBe(200)
    const thirdBody = (await thirdToggle.json()) as { disabled: boolean }
    expect(thirdBody.disabled).toBe(firstBody.disabled)
  })

  test("GET /tools returns builtin tools with disabled state", async () => {
    await using tmp = await tmpdir({
      config: {
        tools: {
          bash: false,
        },
        permission: {
          bash: "allow",
        },
      },
    })

    const app = Server.App()
    const response = await app.request(`/tools?directory=${encodeURIComponent(tmp.path)}`)
    expect(response.status).toBe(200)

    const body = (await response.json()) as Array<{ name: string; category: string; disabled: boolean }>
    const bash = body.find((tool) => tool.name === "bash")
    expect(bash).toBeDefined()
    expect(bash?.category).toBe("builtin")
    expect(bash?.disabled).toBe(true)
    expect(body.some((tool) => tool.name === "invalid")).toBe(false)
  })
})
