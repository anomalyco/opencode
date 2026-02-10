import { describe, expect, test } from "bun:test"
import {
  MAX_PERSIST_BUFFER_BYTES,
  MAX_RESTORE_BUFFER_BYTES,
  preparePersistBuffer,
  prepareRestoreBuffer,
} from "./terminal-buffer"

describe("terminal buffer guards", () => {
  test("restore_buffer_trim_keeps_recent_tail", () => {
    const head = "a".repeat(MAX_RESTORE_BUFFER_BYTES)
    const tail = "tail"
    const value = `${head}${tail}`
    const result = prepareRestoreBuffer(value)
    expect(result.value?.endsWith(tail)).toBe(true)
    expect(result.value?.length).toBe(MAX_RESTORE_BUFFER_BYTES)
  })

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

  test("persist_buffer_trim_keeps_recent_tail", () => {
    const head = "x".repeat(MAX_PERSIST_BUFFER_BYTES)
    const tail = "persist"
    const value = `${head}${tail}`
    const result = preparePersistBuffer(value)
    expect(result.endsWith(tail)).toBe(true)
    expect(result.length).toBe(MAX_PERSIST_BUFFER_BYTES)
  })

  test("persist_then_restore_roundtrip_keeps_latest_tail_exactly", () => {
    const source = "h".repeat(MAX_PERSIST_BUFFER_BYTES + 1024) + "LATEST-TAIL"
    const persisted = preparePersistBuffer(source)
    const restored = prepareRestoreBuffer(persisted)
    expect(restored.trimmed).toBe(false)
    expect(restored.value?.length).toBe(MAX_RESTORE_BUFFER_BYTES)
    expect(restored.value?.endsWith("LATEST-TAIL")).toBe(true)
  })

  test("prepareRestoreBuffer_boundary_does_not_trim_at_exact_limit", () => {
    const value = "z".repeat(MAX_RESTORE_BUFFER_BYTES)
    const result = prepareRestoreBuffer(value)
    expect(result.trimmed).toBe(false)
    expect(result.value).toBe(value)
  })
})
