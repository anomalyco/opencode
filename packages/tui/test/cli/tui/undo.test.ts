import { expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client"
import { undoMessage } from "../../../src/routes/session/undo"

test.each([
  { name: "projected", pending: false, cancelStatus: 204, expected: ["revert"] },
  { name: "pending", pending: true, cancelStatus: 204, expected: ["cancel"] },
  { name: "promoted race", pending: true, cancelStatus: 409, expected: ["cancel", "revert"] },
])("undo routes $name messages", async ({ pending, cancelStatus, expected }) => {
  const calls: string[] = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: Object.assign(
      async (input: URL | RequestInfo, init?: BunFetchRequestInit | RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const operation = request.method === "DELETE" ? "cancel" : "revert"
        calls.push(operation)
        if (operation === "cancel") {
          if (cancelStatus === 409)
            return Response.json({ _tag: "ConflictError", message: "Input was promoted" }, { status: 409 })
          return new Response(null, { status: 204 })
        }
        return Response.json({ data: { messageID: "msg_user" } })
      },
      { preconnect: fetch.preconnect },
    ),
  })

  await undoMessage(client, { sessionID: "ses_test", messageID: "msg_user", pending })

  expect(calls).toEqual([...expected])
})

test("undo does not reinterpret transport failures as promotion races", async () => {
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: Object.assign(
      async () => {
        throw new Error("offline")
      },
      { preconnect: fetch.preconnect },
    ),
  })

  await expect(
    undoMessage(client, { sessionID: "ses_test", messageID: "msg_user", pending: true }),
  ).rejects.toMatchObject({ reason: "Transport" })
})
