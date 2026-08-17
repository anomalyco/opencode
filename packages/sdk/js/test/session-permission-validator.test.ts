import { expect, test } from "bun:test"
import { createOpencodeClient } from "../src/v2/client"

test("supports null session permission validator responses and updates", async () => {
  const requests: Request[] = []
  const client = createOpencodeClient({
    baseUrl: "http://localhost:4096",
    fetch: async (request) => {
      requests.push(request)
      return new Response("null", {
        headers: { "content-type": "application/json" },
      })
    },
  })

  const get = await client.session.permissionValidator.get({ sessionID: "ses_test" })
  const update = await client.session.permissionValidator.update({ sessionID: "ses_test", config: null })

  expect(get.data).toBeNull()
  expect(update.data).toBeNull()
  expect(requests[0].method).toBe("GET")
  expect(requests[1].method).toBe("PATCH")
  expect(await requests[1].json()).toEqual({ config: null })
})
