import { describe, expect, test } from "bun:test"
import type { BetaNotes } from "./beta-notes"
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
  commit: undefined,
  channel: "stable",
  previousVersion: "1.9.1",
  previousCommit: undefined,
  enabled: true,
}

const beta: WhatsNewInit = {
  ...upgraded,
  version: "1.10.0-beta.2",
  commit: "bbb",
  channel: "beta",
  previousVersion: "1.10.0-beta.1",
  previousCommit: "aaa",
}

const highlights: WhatsNewContent = {
  channel: "stable",
  highlights: [{ title: "Split panes", description: "Work side by side." }],
}

const notes: WhatsNewContent = {
  channel: "beta",
  notes: {
    added: [],
    fixed: [{ sha: "bbb", type: "fix", summary: "Fixed a crash" }],
    total: 1,
    more: false,
  } satisfies BetaNotes,
}

const loading = (input: WhatsNewInit) => initWhatsNew(input).state

const markSeen: WhatsNewEffect = { type: "mark-seen", version: "1.10.0", commit: undefined }

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

  test("both channels remember the release as they open its notes, and neither does on dispose", () => {
    expect(transitionWhatsNew(loading(upgraded), { type: "loaded", content: highlights }).effects).toEqual([
      { type: "abort-load" },
      markSeen,
      { type: "open", content: highlights, previousVersion: "1.9.1" },
    ])
    expect(transitionWhatsNew(loading(beta), { type: "loaded", content: notes }).effects).toEqual([
      { type: "abort-load" },
      { type: "mark-seen", version: "1.10.0-beta.2", commit: "bbb" },
      { type: "open", content: notes, previousVersion: "1.10.0-beta.1" },
    ])
    expect(transitionWhatsNew(loading(upgraded), { type: "disposed" }).effects).toEqual([{ type: "abort-load" }])
    expect(transitionWhatsNew(loading(beta), { type: "disposed" }).effects).toEqual([{ type: "abort-load" }])
  })

  test.each([
    { name: "no version", input: { ...upgraded, version: undefined }, effects: [] },
    { name: "the version seen", input: { ...upgraded, previousVersion: "1.10.0" }, effects: [] },
    { name: "the first run", input: { ...upgraded, previousVersion: undefined }, effects: [markSeen] },
    { name: "release notes off", input: { ...upgraded, enabled: false }, effects: [markSeen] },
    {
      name: "release notes off on beta",
      input: { ...beta, enabled: false },
      effects: [{ type: "mark-seen", version: "1.10.0-beta.2", commit: "bbb" }],
    },
  ])("$name loads nothing", (row) => {
    const start = initWhatsNew(row.input)

    expect(start).toEqual({ state: { status: "done" }, effects: row.effects })
    expect(whatsNewLoading(start.state)).toBe(false)
  })

  test("an upgrade loads the channel's notes with a bounded timeout", () => {
    const start = initWhatsNew(beta)

    expect(start).toEqual({
      state: { status: "loading", version: "1.10.0-beta.2", commit: "bbb", previousVersion: "1.10.0-beta.1" },
      effects: [
        {
          type: "load",
          channel: "beta",
          previousVersion: "1.10.0-beta.1",
          previousCommit: "aaa",
          version: "1.10.0-beta.2",
          timeoutMs: WHATS_NEW_TIMEOUT_MS,
        },
      ],
    })
    expect(whatsNewLoading(start.state)).toBe(true)
  })

  test("nothing to show remembers the release; a failed load does not", () => {
    const empty = [undefined, { channel: "stable" as const, highlights: [] }]

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
