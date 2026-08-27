import { expect, test } from "bun:test"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { Share } from "../../src/core/share"
import { app } from "../../src/routes/api/[...path]"

test("share data responses are not cached and disappear after unshare", async () => {
  const sessionID = Identifier.descending()
  const share = await Share.create({ sessionID })
  await Share.sync({
    share: { id: share.id, secret: share.secret },
    data: [
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Private" },
      },
    ],
  })

  const before = await app.fetch(new Request(`https://enterprise.test/api/share/${share.id}/data`))
  expect(before.status).toBe(200)
  expect(before.headers.get("Cache-Control")).toBe("private, no-store")

  await Share.remove({ id: share.id, secret: share.secret })

  const after = await app.fetch(new Request(`https://enterprise.test/api/share/${share.id}/data`))
  expect(after.status).toBe(404)
  expect(after.headers.get("Cache-Control")).toBe("private, no-store")
  expect(await after.text()).toBe(JSON.stringify({ error: `Share not found: ${share.id}` }))
})
