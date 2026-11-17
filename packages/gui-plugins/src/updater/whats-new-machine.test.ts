import { describe, expect, test } from "bun:test"
import {
  initWhatsNew,
  transitionWhatsNew,
  whatsNewLoading,
  WHATS_NEW_TIMEOUT_MS,
  type WhatsNewContent,
  type WhatsNewEffect,
  type WhatsNewInit,
} from "./whats-new-machine"

const upgraded: WhatsNewInit = {
  version: "1.10.0",
  previousVersion: "1.9.1",
  enabled: true,
}

const highlights: WhatsNewContent = {
  highlights: [{ title: "Split panes", description: "Work side by side." }],
}

const loading = (input: WhatsNewInit) => initWhatsNew(input).state

const markSeen: WhatsNewEffect = { type: "mark-seen", version: "1.10.0" }

describe("whats new", () => {
  test("turning release notes off while they load remembers the release and never opens the dialog", () => {
    const disabled = transitionWhatsNew(loading(upgraded), { type: "disabled" })

    expect(disabled).toEqual({ state: { status: "done" }, effects: [{ type: "abort-load" }, markSeen] })

    const late = transitionWhatsNew(disabled.state, { type: "loaded", content: highlights })

    expect(late.state).toBe(disabled.state)
    expect(late.effects).toEqual([])
  })

  test("a changelog that hangs times out and leaves the release for the next start", () => {
    const timedOut = transitionWhatsNew(loading(upgraded), { type: "load.timed-out" })

    expect(timedOut).toEqual({ state: { status: "done" }, effects: [{ type: "abort-load" }] })
    expect(transitionWhatsNew(timedOut.state, { type: "loaded", content: highlights }).effects).toEqual([])
  })

  test("remembers the release as it opens its notes, and not on dispose", () => {
    expect(transitionWhatsNew(loading(upgraded), { type: "loaded", content: highlights }).effects).toEqual([
      { type: "abort-load" },
      markSeen,
      { type: "open", content: highlights },
    ])
    expect(transitionWhatsNew(loading(upgraded), { type: "disposed" }).effects).toEqual([{ type: "abort-load" }])
  })

  test.each([
    { name: "no version", input: { ...upgraded, version: undefined }, effects: [] },
    { name: "the version seen", input: { ...upgraded, previousVersion: "1.10.0" }, effects: [] },
    { name: "the first run", input: { ...upgraded, previousVersion: undefined }, effects: [markSeen] },
    { name: "release notes off", input: { ...upgraded, enabled: false }, effects: [markSeen] },
  ])("$name loads nothing", (row) => {
    const start = initWhatsNew(row.input)

    expect(start).toEqual({ state: { status: "done" }, effects: row.effects })
    expect(whatsNewLoading(start.state)).toBe(false)
  })

  test("an upgrade loads the highlights with a bounded timeout", () => {
    const start = initWhatsNew(upgraded)

    expect(start).toEqual({
      state: { status: "loading", version: "1.10.0" },
      effects: [{ type: "load", previousVersion: "1.9.1", version: "1.10.0", timeoutMs: WHATS_NEW_TIMEOUT_MS }],
    })
    expect(whatsNewLoading(start.state)).toBe(true)
  })

  test("nothing to show remembers the release; a failed load does not", () => {
    const empty = [undefined, { highlights: [] }]

    empty.forEach((content) =>
      expect(transitionWhatsNew(loading(upgraded), { type: "loaded", content }).effects).toEqual([
        { type: "abort-load" },
        markSeen,
      ]),
    )
    expect(transitionWhatsNew(loading(upgraded), { type: "load.failed" })).toEqual({
      state: { status: "done" },
      effects: [{ type: "abort-load" }],
    })
  })
})
