import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { createSessionMutations } from "./data"

const session = { id: "ses_test" } as SessionInfo

test("keeps a removed session hidden after its deletion event, for lists cached before it", async () => {
  const release = Promise.withResolvers<void>()
  const mutation = createSessionMutations(async () => release.promise)

  const request = mutation.remove(session.id)
  expect(mutation.apply([session])).toEqual([])
  release.resolve()
  await request
  expect(mutation.apply([session])).toEqual([])

  mutation.deleted(session.id)
  expect(mutation.apply([session])).toEqual([])
})

test("hides a session another client deleted", () => {
  const mutation = createSessionMutations(async () => {})
  mutation.deleted(session.id)
  expect(mutation.apply([session])).toEqual([])
})

test("rolls back a failed removal", async () => {
  const release = Promise.withResolvers<void>()

  const mutation = createSessionMutations(async () => {
    await release.promise
    throw new Error("offline")
  })

  const request = mutation.remove(session.id)
  expect(mutation.apply([session])).toEqual([])
  release.resolve()
  await expect(request).rejects.toThrow("offline")
  expect(mutation.apply([session])).toEqual([session])
})
