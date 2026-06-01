import { afterEach, describe, expect, test } from "bun:test"
import { probeModelIDs } from "../../src/local/mdns"

let server: ReturnType<typeof Bun.serve> | undefined

afterEach(() => {
  server?.stop(true)
  server = undefined
})

function serve(handler: (request: Request) => Response | Promise<Response>) {
  server = Bun.serve({ port: 0, fetch: handler })
  return server.url.toString().replace(/\/$/, "")
}

describe("probeModelIDs", () => {
  test("treats an empty model list as an online provider", async () => {
    const baseURL = serve((request) => {
      const url = new URL(request.url)
      if (url.pathname === "/v1/models") return Response.json({ object: "list", data: [] })
      return new Response("not found", { status: 404 })
    })

    await expect(probeModelIDs(`${baseURL}/v1`)).resolves.toEqual([])
  })

  test("returns null when the provider probe fails", async () => {
    const baseURL = serve(() => new Response("not ready", { status: 503 }))

    await expect(probeModelIDs(baseURL)).resolves.toBeNull()
  })
})
