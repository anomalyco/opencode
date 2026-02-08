import { describe, expect, test } from "bun:test"
import {
  MAX_PERSIST_BUFFER_BYTES,
  MAX_RESTORE_BUFFER_BYTES,
  preparePersistBuffer,
  prepareRestoreBuffer,
} from "./terminal-buffer"

describe("terminal buffer guards", () => {
  test("prepareRestoreBuffer trims oversized buffers to recent bytes", () => {
    const head = "a".repeat(MAX_RESTORE_BUFFER_BYTES)
    const tail = "b".repeat(128)
    const value = `${head}${tail}`
    const result = prepareRestoreBuffer(value)
    expect(result.value?.length).toBe(MAX_RESTORE_BUFFER_BYTES)
    expect(result.trimmed).toBe(true)
    expect(result.value?.endsWith(tail)).toBe(true)
  })

  test("preparePersistBuffer trims oversized buffers to recent bytes", () => {
    const head = "x".repeat(MAX_PERSIST_BUFFER_BYTES)
    const tail = "y".repeat(64)
    const value = `${head}${tail}`
    const result = preparePersistBuffer(value)
    expect(result.length).toBe(MAX_PERSIST_BUFFER_BYTES)
    expect(result.endsWith(tail)).toBe(true)
  })
})
