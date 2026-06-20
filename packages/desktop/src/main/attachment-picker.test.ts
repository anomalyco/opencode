import { describe, expect, test } from "bun:test"
import {
  createPickedFileAuthorizations,
  assertAttachmentBudget,
  MAX_ATTACHMENT_BYTES,
} from "./attachment-picker"

function mockRead(data: Record<string, ArrayBuffer>) {
  return async (path: string, maxBytes: number): Promise<ArrayBuffer> => {
    const buf = data[path]
    if (!buf) throw new Error(`File not found: ${path}`)
    if (buf.byteLength > maxBytes)
      throw new Error(`Selected attachments exceed the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`)
    return buf
  }
}

function makeBuffer(size: number): ArrayBuffer {
  return new ArrayBuffer(size)
}

describe("createPickedFileAuthorizations", () => {
  describe("add and read", () => {
    test("returns a unique token on add", () => {
      const auth = createPickedFileAuthorizations()
      const t1 = auth.add(1, ["/a.txt"])
      const t2 = auth.add(1, ["/b.txt"])
      expect(t1).not.toBe(t2)
      expect(typeof t1).toBe("string")
    })

    test("allows reading an authorized path", async () => {
      const data = { "/a.txt": makeBuffer(100) }
      const auth = createPickedFileAuthorizations(mockRead(data))
      const token = auth.add(42, ["/a.txt"])
      const result = await auth.read(42, token, "/a.txt")
      expect(result.byteLength).toBe(100)
    })

    test("rejects reading an unauthorized path", async () => {
      const auth = createPickedFileAuthorizations()
      const token = auth.add(1, ["/a.txt"])
      expect(auth.read(1, token, "/b.txt")).rejects.toThrow("File was not selected by the picker")
    })

    test("rejects reading with wrong sender", async () => {
      const auth = createPickedFileAuthorizations()
      const token = auth.add(1, ["/a.txt"])
      expect(auth.read(2, token, "/a.txt")).rejects.toThrow("File was not selected by the picker")
    })

    test("rejects reading with invalid token", async () => {
      const auth = createPickedFileAuthorizations()
      expect(auth.read(1, "bogus-token", "/a.txt")).rejects.toThrow("File was not selected by the picker")
    })

    test("each path can only be read once (one-shot)", async () => {
      const data = { "/a.txt": makeBuffer(50) }
      const auth = createPickedFileAuthorizations(mockRead(data))
      const token = auth.add(1, ["/a.txt"])
      await auth.read(1, token, "/a.txt")
      expect(auth.read(1, token, "/a.txt")).rejects.toThrow("File was not selected by the picker")
    })

    test("multiple paths in one selection are independent", async () => {
      const data = { "/a.txt": makeBuffer(10), "/b.txt": makeBuffer(20) }
      const auth = createPickedFileAuthorizations(mockRead(data))
      const token = auth.add(1, ["/a.txt", "/b.txt"])
      const a = await auth.read(1, token, "/a.txt")
      expect(a.byteLength).toBe(10)
      const b = await auth.read(1, token, "/b.txt")
      expect(b.byteLength).toBe(20)
    })
  })

  describe("budget enforcement", () => {
    test("tracks remaining budget across reads", async () => {
      const data = { "/a.txt": makeBuffer(15 * 1024 * 1024), "/b.txt": makeBuffer(10 * 1024 * 1024) }
      const auth = createPickedFileAuthorizations(mockRead(data), MAX_ATTACHMENT_BYTES)
      const token = auth.add(1, ["/a.txt", "/b.txt"])
      await auth.read(1, token, "/a.txt") // uses 15MB of 20MB budget
      // Second read would need 10MB but only 5MB remains
      expect(auth.read(1, token, "/b.txt")).rejects.toThrow("exceed")
    })

    test("custom budget is respected", async () => {
      const data = { "/a.txt": makeBuffer(100) }
      const auth = createPickedFileAuthorizations(mockRead(data), 50)
      const token = auth.add(1, ["/a.txt"])
      expect(auth.read(1, token, "/a.txt")).rejects.toThrow("exceed")
    })
  })

  describe("release", () => {
    test("release invalidates the token", async () => {
      const data = { "/a.txt": makeBuffer(10) }
      const auth = createPickedFileAuthorizations(mockRead(data))
      const token = auth.add(1, ["/a.txt"])
      auth.release(1, token)
      expect(auth.read(1, token, "/a.txt")).rejects.toThrow("File was not selected by the picker")
    })

    test("release with wrong sender is a no-op", async () => {
      const data = { "/a.txt": makeBuffer(10) }
      const auth = createPickedFileAuthorizations(mockRead(data))
      const token = auth.add(1, ["/a.txt"])
      auth.release(2, token) // wrong sender
      // Should still be readable
      const result = await auth.read(1, token, "/a.txt")
      expect(result.byteLength).toBe(10)
    })

    test("release with nonexistent token does not throw", () => {
      const auth = createPickedFileAuthorizations()
      expect(() => auth.release(1, "nonexistent")).not.toThrow()
    })
  })

  describe("auto-cleanup", () => {
    test("token is auto-deleted after all paths are read", async () => {
      const data = { "/a.txt": makeBuffer(10) }
      const auth = createPickedFileAuthorizations(mockRead(data))
      const token = auth.add(1, ["/a.txt"])
      await auth.read(1, token, "/a.txt")
      // Token should be gone; release should be a no-op
      expect(() => auth.release(1, token)).not.toThrow()
    })
  })
})

describe("assertAttachmentBudget", () => {
  test("passes when total is within budget", () => {
    expect(() => assertAttachmentBudget([{ size: 100 }, { size: 200 }])).not.toThrow()
  })

  test("passes at exactly the budget limit", () => {
    expect(() => assertAttachmentBudget([{ size: MAX_ATTACHMENT_BYTES }])).not.toThrow()
  })

  test("throws when total exceeds budget", () => {
    expect(() => assertAttachmentBudget([{ size: MAX_ATTACHMENT_BYTES + 1 }])).toThrow("exceed")
  })

  test("passes for empty list", () => {
    expect(() => assertAttachmentBudget([])).not.toThrow()
  })
})
