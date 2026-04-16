import { describe, expect, test } from "bun:test"
import { isBinaryBytes } from "../../../src/workspace/helpers/is-binary"

const enc = new TextEncoder()

describe("helpers/is-binary — isBinaryBytes", () => {
  test("known binary extension short-circuits regardless of bytes", () => {
    expect(isBinaryBytes(".zip", new Uint8Array(0))).toBe(true)
    expect(isBinaryBytes(".EXE", enc.encode("plain text"))).toBe(true)
  })

  test("text extension + printable bytes → false", () => {
    expect(isBinaryBytes(".ts", enc.encode("const x = 1\n"))).toBe(false)
    expect(isBinaryBytes(".md", enc.encode("# hello\n\nworld"))).toBe(false)
  })

  test("empty bytes with unknown extension → false", () => {
    expect(isBinaryBytes(".unknown", new Uint8Array(0))).toBe(false)
  })

  test("NUL byte in sample triggers binary", () => {
    const buf = new Uint8Array([65, 66, 67, 0, 68])
    expect(isBinaryBytes(".bin-like", buf)).toBe(true)
  })

  test(">30% non-printable bytes triggers binary", () => {
    const buf = new Uint8Array(100)
    for (let i = 0; i < 100; i++) buf[i] = i < 40 ? 0x01 : 65 // first 40 non-printable
    expect(isBinaryBytes(".mystery", buf)).toBe(true)
  })

  test("tab / newline / carriage return are printable", () => {
    const buf = enc.encode("a\tb\nc\rd")
    expect(isBinaryBytes(".txt", buf)).toBe(false)
  })
})
