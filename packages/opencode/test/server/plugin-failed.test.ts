import { describe, expect, test, mock } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("/plugin/failed endpoint", () => {
  test("should return 200 and an array", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #when
        const app = Server.App()
        const response = await app.request("/plugin/failed", {
          method: "GET",
        })

        // #then
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(Array.isArray(body)).toBe(true)
      },
    })
  })

  test("should return items with correct structure when plugins fail", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #when
        const app = Server.App()
        const response = await app.request("/plugin/failed", {
          method: "GET",
        })

        // #then
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(Array.isArray(body)).toBe(true)

        // If there are any failed plugins, verify their structure
        for (const item of body) {
          expect(typeof item.pkg).toBe("string")
          expect(typeof item.version).toBe("string")
          expect(typeof item.error).toBe("string")
          expect(typeof item.authMethod).toBe("string")
        }
      },
    })
  })
})
