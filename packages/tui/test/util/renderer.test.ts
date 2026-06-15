import { expect, test } from "bun:test"
import { destroyRenderer, TERMINAL_MODE_RESET_SEQUENCE, TERMINAL_MODE_RESETS } from "../../src/util/renderer"

test("resets terminal modes before and after destroying the renderer", () => {
  const calls: string[] = []
  destroyRenderer(
    {
      isDestroyed: false,
      setTerminalTitle(title) {
        calls.push(`title:${title}`)
      },
      destroy() {
        calls.push("destroy")
      },
    },
    {
      write(data) {
        calls.push(`write:${data}`)
      },
    },
  )
  expect(calls).toEqual([
    "title:",
    `write:${TERMINAL_MODE_RESET_SEQUENCE}`,
    "destroy",
    `write:${TERMINAL_MODE_RESET_SEQUENCE}`,
  ])
})

test("still resets terminal modes after renderer destruction", () => {
  const calls: string[] = []
  destroyRenderer(
    {
      isDestroyed: true,
      setTerminalTitle(title) {
        calls.push(`title:${title}`)
      },
      destroy() {
        calls.push("destroy")
      },
    },
    {
      write(data) {
        calls.push(`write:${data}`)
      },
    },
  )
  expect(calls).toEqual(["title:", `write:${TERMINAL_MODE_RESET_SEQUENCE}`])
})

test("still destroys the renderer when terminal reset writes fail", () => {
  const calls: string[] = []
  destroyRenderer(
    {
      isDestroyed: false,
      setTerminalTitle(title) {
        calls.push(`title:${title}`)
      },
      destroy() {
        calls.push("destroy")
      },
    },
    {
      write(data) {
        calls.push(`write:${data}`)
        throw new Error("write failed")
      },
    },
  )
  expect(calls).toEqual([
    "title:",
    `write:${TERMINAL_MODE_RESET_SEQUENCE}`,
    "destroy",
    `write:${TERMINAL_MODE_RESET_SEQUENCE}`,
  ])
})

test("terminal mode reset sequences are unique and generated from one registry", () => {
  expect(new Set(TERMINAL_MODE_RESETS.map((mode) => mode.name)).size).toBe(TERMINAL_MODE_RESETS.length)
  expect(new Set(TERMINAL_MODE_RESETS.map((mode) => mode.sequence)).size).toBe(TERMINAL_MODE_RESETS.length)
  expect(TERMINAL_MODE_RESET_SEQUENCE).toBe(TERMINAL_MODE_RESETS.map((mode) => mode.sequence).join(""))
})
