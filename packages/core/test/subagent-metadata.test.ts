import { describe, expect, test } from "bun:test"
import { SubagentMetadata } from "@opencode/core/session/subagent-metadata"

const silent = { [SubagentMetadata.KEY]: false } as const
const silentThread = { threadID: "123", [SubagentMetadata.KEY]: false } as const
const thread = { threadID: "123" } as const

describe("SubagentMetadata.notify", () => {
  test("defaults to loud when the switch is absent", () => {
    expect(SubagentMetadata.notify(undefined)).toBe(true)
    expect(SubagentMetadata.notify({})).toBe(true)
    expect(SubagentMetadata.notify(thread)).toBe(true)
    expect(SubagentMetadata.notify({ [SubagentMetadata.KEY]: true })).toBe(true)
  })

  test("only an explicit false silences the link", () => {
    expect(SubagentMetadata.notify(silent)).toBe(false)
    expect(SubagentMetadata.notify(silentThread)).toBe(false)
  })
})

describe("SubagentMetadata.inherit", () => {
  test("returns metadata without the switch unchanged", () => {
    expect(SubagentMetadata.inherit(undefined)).toBeUndefined()
    expect(SubagentMetadata.inherit(thread)).toBe(thread)
  })

  test("strips the switch and keeps host annotations", () => {
    expect(SubagentMetadata.inherit(silentThread)).toEqual({ threadID: "123" })
    expect(SubagentMetadata.inherit({ ...thread, [SubagentMetadata.KEY]: true })).toEqual({ threadID: "123" })
  })

  test("collapses metadata that only carried the switch", () => {
    expect(SubagentMetadata.inherit(silent)).toBeUndefined()
  })
})

describe("SubagentMetadata.apply", () => {
  test("writes an explicit false", () => {
    expect(SubagentMetadata.apply(undefined, false)).toEqual({ [SubagentMetadata.KEY]: false })
    expect(SubagentMetadata.apply(thread, false)).toEqual({ threadID: "123", [SubagentMetadata.KEY]: false })
  })

  test("loud stays clean by stripping the switch", () => {
    expect(SubagentMetadata.apply(undefined, true)).toBeUndefined()
    expect(SubagentMetadata.apply(thread, true)).toEqual({ threadID: "123" })
    expect(SubagentMetadata.apply(silent, true)).toBeUndefined()
    expect(SubagentMetadata.apply(silentThread, true)).toEqual({ threadID: "123" })
  })
})

describe("SubagentMetadata.withNotify", () => {
  test("creates loud children from absent or silent parents", () => {
    expect(SubagentMetadata.withNotify(undefined, true)).toBeUndefined()
    expect(SubagentMetadata.withNotify(thread, true)).toEqual({ threadID: "123" })
    expect(SubagentMetadata.withNotify(silent, true)).toBeUndefined()
    expect(SubagentMetadata.withNotify(silentThread, true)).toEqual({ threadID: "123" })
  })

  test("creates silent children without inheriting the parent's switch", () => {
    expect(SubagentMetadata.withNotify(undefined, false)).toEqual({ [SubagentMetadata.KEY]: false })
    expect(SubagentMetadata.withNotify(thread, false)).toEqual({ threadID: "123", [SubagentMetadata.KEY]: false })
    expect(SubagentMetadata.withNotify(silentThread, false)).toEqual({
      threadID: "123",
      [SubagentMetadata.KEY]: false,
    })
  })
})

describe("SubagentMetadata.update", () => {
  test("skips writes that would not change the link state", () => {
    expect(SubagentMetadata.update(undefined, true)).toBeUndefined()
    expect(SubagentMetadata.update({}, true)).toBeUndefined()
    expect(SubagentMetadata.update(thread, true)).toBeUndefined()
    expect(SubagentMetadata.update({ [SubagentMetadata.KEY]: true }, true)).toBeUndefined()
    expect(SubagentMetadata.update(silent, false)).toBeUndefined()
    expect(SubagentMetadata.update(silentThread, false)).toBeUndefined()
  })

  test("returns the metadata to persist on a transition", () => {
    expect(SubagentMetadata.update(undefined, false)).toEqual({ [SubagentMetadata.KEY]: false })
    expect(SubagentMetadata.update(thread, false)).toEqual({ threadID: "123", [SubagentMetadata.KEY]: false })
    expect(SubagentMetadata.update(silentThread, true)).toEqual({ threadID: "123" })
  })

  test("returns an empty object when clearing the last key", () => {
    expect(SubagentMetadata.update(silent, true)).toEqual({})
  })
})
