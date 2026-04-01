import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

describe("/doc", () => {
  test("includes live instance routes in the generated spec", async () => {
    const app = Server.Default()

    const doc = await app.request("/doc")
    expect(doc.status).toBe(200)

    const body = await doc.json()
    expect(Object.keys(body.paths)).toContain("/project/current")
  })
})
