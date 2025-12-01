import { describe, expect, test, afterAll } from "bun:test"
import { Share } from "../../src/core/share"
import { Storage } from "../../src/core/storage"
import { Identifier } from "@opencode-ai/util/identifier"

describe.concurrent("core.share", () => {
  test("should create a share", async () => {
    const sessionID = Identifier.descending()
    const share = await Share.create({ sessionID })

    expect(share.sessionID).toBe(sessionID)
    expect(share.secret).toBeDefined()

    await Share.remove({ id: share.id, secret: share.secret })
  })

  test("should sync data to a share", async () => {
    const sessionID = Identifier.descending()
    const share = await Share.create({ sessionID })

    const data: Share.Data[] = [
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Hello" },
      },
    ]

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data,
    })

    const events = await Storage.list({ prefix: ["share_event", share.id] })
    expect(events.length).toBe(1)

    await Share.remove({ id: share.id, secret: share.secret })
  })

  test("should sync multiple batches of data", async () => {
    const sessionID = Identifier.descending()
    const share = await Share.create({ sessionID })

    const data1: Share.Data[] = [
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Hello" },
      },
    ]

    const data2: Share.Data[] = [
      {
        type: "part",
        data: { id: "part2", sessionID, messageID: "msg1", type: "text", text: "World" },
      },
    ]

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data: data1,
    })

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data: data2,
    })

    const events = await Storage.list({ prefix: ["share_event", share.id] })
    expect(events.length).toBe(2)

    await Share.remove({ id: share.id, secret: share.secret })
  })

  test("should retrieve synced data", async () => {
    const sessionID = Identifier.descending()
    const share = await Share.create({ sessionID })

    const data: Share.Data[] = [
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Hello" },
      },
      {
        type: "part",
        data: { id: "part2", sessionID, messageID: "msg1", type: "text", text: "World" },
      },
    ]

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data,
    })

    const result = await Share.data(share.id)

    expect(result.length).toBe(2)
    expect(result[0].type).toBe("part")
    expect(result[1].type).toBe("part")

    await Share.remove({ id: share.id, secret: share.secret })
  })

  test("should retrieve data from multiple syncs", async () => {
    const sessionID = Identifier.descending()
    const share = await Share.create({ sessionID })

    const data1: Share.Data[] = [
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Hello" },
      },
    ]

    const data2: Share.Data[] = [
      {
        type: "part",
        data: { id: "part2", sessionID, messageID: "msg2", type: "text", text: "World" },
      },
    ]

    const data3: Share.Data[] = [
      { type: "part", data: { id: "part3", sessionID, messageID: "msg3", type: "text", text: "!" } },
    ]

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data: data1,
    })

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data: data2,
    })

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data: data3,
    })

    const result = await Share.data(share.id)

    expect(result.length).toBe(3)
    const parts = result.filter((d) => d.type === "part")
    expect(parts.length).toBe(3)

    await Share.remove({ id: share.id, secret: share.secret })
  })

  test("should return latest data when syncing duplicate parts", async () => {
    const sessionID = Identifier.descending()
    const share = await Share.create({ sessionID })

    const data1: Share.Data[] = [
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Hello" },
      },
    ]

    const data2: Share.Data[] = [
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Hello Updated" },
      },
    ]

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data: data1,
    })

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data: data2,
    })

    const result = await Share.data(share.id)

    expect(result.length).toBe(1)
    const [first] = result
    expect(first.type).toBe("part")
    expect(first.type === "part" && first.data.type === "text" && first.data.text).toBe("Hello Updated")

    await Share.remove({ id: share.id, secret: share.secret })
  })

  test("should return empty array for share with no data", async () => {
    const sessionID = Identifier.descending()
    const share = await Share.create({ sessionID })

    const result = await Share.data(share.id)

    expect(result).toEqual([])

    await Share.remove({ id: share.id, secret: share.secret })
  })

  test("should throw error for invalid secret", async () => {
    const sessionID = Identifier.descending()
    const share = await Share.create({ sessionID })

    const data: Share.Data[] = [
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Test" },
      },
    ]

    expect(async () => {
      await Share.sync({
        share: { id: share.id, secret: "invalid-secret" },
        data,
      })
    }).toThrow()

    await Share.remove({ id: share.id, secret: share.secret })
  })

  test("should throw error for non-existent share", async () => {
    const sessionID = Identifier.descending()
    const data: Share.Data[] = [
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Test" },
      },
    ]

    expect(async () => {
      await Share.sync({
        share: { id: "non-existent-id", secret: "some-secret" },
        data,
      })
    }).toThrow()
  })

  test("should handle different data types", async () => {
    const sessionID = Identifier.descending()
    const share = await Share.create({ sessionID })

    const data: Share.Data[] = [
      { type: "session", data: { id: sessionID, status: "running" } as any },
      { type: "message", data: { id: "msg1", sessionID } as any },
      {
        type: "part",
        data: { id: "part1", sessionID, messageID: "msg1", type: "text", text: "Hello" },
      },
    ]

    await Share.sync({
      share: { id: share.id, secret: share.secret },
      data,
    })

    const result = await Share.data(share.id)

    expect(result.length).toBe(3)
    expect(result.some((d) => d.type === "session")).toBe(true)
    expect(result.some((d) => d.type === "message")).toBe(true)
    expect(result.some((d) => d.type === "part")).toBe(true)

    await Share.remove({ id: share.id, secret: share.secret })
  })
})
