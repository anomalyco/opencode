/**
 * Storage Adapter Tests
 * Unit tests for the storage adapter implementation
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { MockStorageAdapter, Storage } from "./storage"

describe("MockStorageAdapter", () => {
  let adapter: MockStorageAdapter<any>

  beforeEach(() => {
    adapter = new MockStorageAdapter()
  })

  it("should put and get values", async () => {
    const testData = { id: "test", secret: "secret123", sessionID: "session123" }

    await adapter.put("test-key", testData)
    const result = await adapter.get("test-key")

    expect(result).toEqual(testData)
  })

  it("should return null for non-existent keys", async () => {
    const result = await adapter.get("non-existent-key")
    expect(result).toBeNull()
  })

  it("should delete values", async () => {
    const testData = { id: "test", secret: "secret123" }

    await adapter.put("test-key", testData)
    await adapter.delete("test-key")
    const result = await adapter.get("test-key")

    expect(result).toBeNull()
  })

  it("should check if values exist", async () => {
    const testData = { id: "test" }

    expect(await adapter.exists("test-key")).toBeFalse()

    await adapter.put("test-key", testData)
    expect(await adapter.exists("test-key")).toBeTrue()
  })

  it("should list values with prefix", async () => {
    const data1 = { id: "test1" }
    const data2 = { id: "test2" }
    const data3 = { id: "other" }

    await adapter.put("credentials/test1", data1)
    await adapter.put("credentials/test2", data2)
    await adapter.put("sessions/other", data3)

    const result = await adapter.list({ prefix: "credentials/" })
    expect(result.length).toBe(2)
    const first = result[0]
    const second = result[1]
    if (!first || !second) throw new Error("Expected list entries")
    expect(first.key).toContain("credentials/")
    expect(second.key).toContain("credentials/")
  })

  it("should clear all data", async () => {
    const testData = { id: "test" }

    await adapter.put("test-key", testData)
    expect(await adapter.get("test-key")).not.toBeNull()

    adapter.clear()
    expect(await adapter.get("test-key")).toBeNull()
  })
})

describe("Storage Utilities", () => {
  let adapter: MockStorageAdapter<any>

  beforeEach(() => {
    adapter = new MockStorageAdapter()
  })

  it("should apply function to retrieved value", async () => {
    const testData = { count: 5 }
    await adapter.put("test-key", testData)

    const result = await Storage.withValue(adapter, "test-key", (value) => value.count * 2)

    expect(result).toBe(10)
  })

  it("should return null when applying function to non-existent value", async () => {
    const result = await Storage.withValue(adapter, "non-existent-key", (value) => value.count * 2)

    expect(result).toBeNull()
  })

  it("should update value using transformation function", async () => {
    const initialData = { count: 5 }
    await adapter.put("test-key", initialData)

    await Storage.update(adapter, "test-key", (current) => ({
      count: (current?.count || 0) + 1,
    }))

    const result = await adapter.get("test-key")
    expect(result).toEqual({ count: 6 })
  })

  it("should create new value when updating non-existent key", async () => {
    await Storage.update(adapter, "test-key", (current) => ({
      count: (current?.count || 0) + 1,
    }))

    const result = await adapter.get("test-key")
    expect(result).toEqual({ count: 1 })
  })
})
