import { describe, expect, test } from "bun:test"
import { RemoteAttachment, TEXT_ATTACHMENT_TTL_MS } from "./attachment"
import { SessionID } from "./session/schema"

const session = SessionID.make("ses_1")

describe("RemoteAttachment", () => {
  test("stores text for one session and consumes it exactly once", () => {
    const store = RemoteAttachment.createStore()
    const uploaded = store.upload({ sessionID: session, filename: "pasted.txt", content: "first\nsecond" })

    expect(uploaded.url).toBe(`attachment://${uploaded.id}`)
    expect(store.consume({ sessionID: SessionID.make("ses_2"), id: uploaded.id })).toBeUndefined()
    expect(store.consume({ sessionID: session, id: uploaded.id })).toEqual({
      filename: "pasted.txt",
      content: "first\nsecond",
    })
    expect(store.consume({ sessionID: session, id: uploaded.id })).toBeUndefined()
  })

  test("removes expired uploads before they can be referenced", () => {
    let now = 0
    const store = RemoteAttachment.createStore(() => now)
    const uploaded = store.upload({ sessionID: session, filename: "pasted.txt", content: "text" })

    now += TEXT_ATTACHMENT_TTL_MS
    expect(store.consume({ sessionID: session, id: uploaded.id })).toBeUndefined()
  })

  test("removes an unused upload on request", () => {
    const store = RemoteAttachment.createStore()
    const uploaded = store.upload({ sessionID: session, filename: "pasted.txt", content: "text" })

    store.remove({ sessionID: session, id: uploaded.id })
    expect(store.consume({ sessionID: session, id: uploaded.id })).toBeUndefined()
  })
})
