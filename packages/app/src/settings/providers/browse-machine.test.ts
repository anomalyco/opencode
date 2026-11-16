import { describe, expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client/promise"
import type { BrowseStatus } from "@/runtime/platform/platform"
import {
  browseCardPolling,
  browseCardView,
  browseSetupEnabled,
  createBrowseCardState,
  transitionBrowseCard,
  type BrowseCardEffect,
  type BrowseCardEvent,
  type BrowseCardState,
} from "./browse-machine"

const status = (patch: Partial<BrowseStatus> = {}): BrowseStatus => ({
  installed: false,
  configured: false,
  extension: "unknown",
  job: { status: "idle" },
  ...patch,
})

const replay = (events: readonly BrowseCardEvent[], from?: BrowseCardState) => {
  const initial = createBrowseCardState()

  return events.reduce<{ state: BrowseCardState; effects: BrowseCardEffect[] }>(
    (result, event) => {
      const next = transitionBrowseCard(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: from ?? initial.state, effects: from ? [] : [...initial.effects] },
  )
}

describe("browse card machine", () => {
  test("install, add the extension, connect: the row follows it and refreshes MCPs once it finishes", () => {
    const run = replay([
      { type: "read.succeeded", attempt: 1, browse: status() },
      { type: "install.requested" },
      { type: "install.requested" },
      { type: "install.started", attempt: 2 },
      {
        type: "read.succeeded",
        attempt: 3,
        browse: status({ installed: true, configured: true, extension: "not-seen", job: { status: "installing" } }),
      },
      { type: "refresh.requested" },
      {
        type: "read.succeeded",
        attempt: 4,
        browse: status({ installed: true, configured: true, extension: "connected" }),
      },
    ])

    expect(run.effects).toEqual([
      { type: "read", attempt: 1 },
      { type: "install", attempt: 2 },
      { type: "read", attempt: 3 },
      { type: "read", attempt: 4 },
      { type: "sync-mcps" },
    ])
    expect(browseCardView(run.state)).toEqual({ phase: "ready", connected: true })
    expect(browseCardPolling(run.state)).toBe(false)
  })

  test("while the installer waits for the extension the row polls and offers the Chrome Web Store", () => {
    const run = replay([
      {
        type: "read.succeeded",
        attempt: 1,
        browse: status({ installed: true, configured: true, extension: "not-seen", job: { status: "installing" } }),
      },
    ])

    expect(browseCardView(run.state)).toEqual({ phase: "installing", store: true })
    expect(browseCardPolling(run.state)).toBe(true)
  })

  test("a poll that answers late is ignored, and a failed poll keeps what the row shows", () => {
    const ready = replay([
      { type: "read.succeeded", attempt: 1, browse: status({ installed: true, configured: true }) },
      { type: "refresh.requested" },
      { type: "refresh.requested" },
    ]).state

    expect(transitionBrowseCard(ready, { type: "read.succeeded", attempt: 2, browse: status() }).state).toBe(ready)
    expect(transitionBrowseCard(ready, { type: "read.failed", attempt: 3 }).state).toBe(ready)
  })

  test("a first read that fails can be retried", () => {
    const run = replay([{ type: "read.failed", attempt: 1 }, { type: "refresh.requested" }])

    expect(run.effects.at(-1)).toEqual({ type: "read", attempt: 2 })
    expect(browseCardView(replay([{ type: "read.failed", attempt: 1 }]).state)).toEqual({ phase: "unavailable" })
  })

  test("an install the desktop refused shows its error and can be retried", () => {
    const run = replay([
      { type: "read.succeeded", attempt: 1, browse: status() },
      { type: "install.requested" },
      { type: "install.failed", attempt: 2 },
    ])

    expect(browseCardView(run.state)).toEqual({ phase: "absent", failure: { reason: "start" } })
    expect(transitionBrowseCard(run.state, { type: "install.requested" }).effects).toEqual([
      { type: "install", attempt: 3 },
    ])
  })

  test.each([
    { browse: status({ installed: true }), view: { phase: "incomplete", reason: "config", store: false } },
    {
      browse: status({ installed: true, configured: true, extension: "not-seen" }),
      view: { phase: "incomplete", reason: "extension", store: true },
    },
    {
      browse: status({ installed: true, configured: true, extension: "refused" }),
      view: { phase: "incomplete", reason: "pairing", store: false },
    },
    {
      browse: status({
        installed: true,
        configured: true,
        extension: "not-seen",
        job: { status: "failed", failure: { reason: "installer", detail: "Not connected yet" } },
      }),
      view: {
        phase: "incomplete",
        reason: "extension",
        store: true,
        failure: { reason: "installer", detail: "Not connected yet" },
      },
    },
    { browse: status({ installed: true, configured: true }), view: { phase: "ready", connected: false } },
    {
      browse: status({ installed: true, configured: true, extension: "paired-offline" }),
      view: { phase: "ready", connected: false },
    },
  ])("view of $browse", ({ browse, view }) => {
    expect(browseCardView(replay([{ type: "read.succeeded", attempt: 1, browse }]).state)).toEqual(view)
  })

  test("disposal drops every later result", () => {
    const disposed = replay([{ type: "disposed" }]).state

    expect(transitionBrowseCard(disposed, { type: "read.succeeded", attempt: 1, browse: status() }).state).toBe(
      disposed,
    )
  })
})

describe("browse_setup flag", () => {
  const doc = (experimental?: { browse_setup?: boolean; all_flags?: boolean }): ConfigEntry => ({
    type: "document",
    path: "/config/opencode.json",
    info: experimental ? { experimental } : {},
  })

  test.each([
    { name: "config not loaded", entries: undefined, channel: "dev", enabled: false },
    { name: "dev build by default", entries: [doc()], channel: "dev", enabled: true },
    { name: "local build by default", entries: [doc()], channel: "local", enabled: true },
    { name: "release by default", entries: [doc()], channel: "prod", enabled: false },
    { name: "turned off on a dev build", entries: [doc({ browse_setup: false })], channel: "dev", enabled: false },
    { name: "turned on in a release", entries: [doc({ browse_setup: true })], channel: "prod", enabled: true },
    { name: "all_flags in a release", entries: [doc({ all_flags: true })], channel: "prod", enabled: true },
    {
      name: "the highest-priority experimental block decides",
      entries: [doc({ browse_setup: true }), doc({ browse_setup: false })],
      channel: "prod",
      enabled: false,
    },
    {
      name: "all_flags survives a later block that doesn't set it",
      entries: [doc({ all_flags: true }), doc({})],
      channel: "prod",
      enabled: true,
    },
  ])("$name", ({ entries, channel, enabled }) => {
    expect(browseSetupEnabled(entries, channel)).toBe(enabled)
  })
})
