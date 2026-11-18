import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  createDocumentState,
  documentGeneration,
  documentTab,
  documentVisible,
  frameStillCurrent,
  isDocumentLoading,
  isNavigationPending,
  leftApprovedSite,
  retryOnly,
  transitionDocument,
  type DocumentEvent,
  type DocumentState,
  type DocumentTransition,
} from "./page-machine"

const history = { id: Browser.TabID.make(`tab_${"0".repeat(36)}`), canGoBack: false, canGoForward: false }

// Folds the events in order and returns the last transition, with every effect on the way.
const replay = (events: readonly DocumentEvent[], state: DocumentState = createDocumentState()) =>
  events.reduce<DocumentTransition & { all: DocumentTransition["effects"] }>(
    (last, event) => {
      const next = transitionDocument(last.state, event)

      return { ...next, all: [...last.all, ...next.effects] }
    },
    { state, effects: [], all: [] },
  )

const types = (effects: DocumentTransition["effects"]) => effects.map((effect) => effect.type)

test("Back, Forward and Stop on a restore stopped before it was issued are not a site change", () => {
  const site = "https://ledger.test"

  // The startup gate held the saved address and Stop (or the agent's Back) ended the wait: nothing committed, the
  // renderer shows its inert blank document, and the saved address stays.
  const held = replay(
    [
      { type: "navigation.started", url: `${site}/article`, isMainFrame: true, isSameDocument: false },
      { type: "loading.started" },
      { type: "navigation.held-stopped", address: `${site}/article` },
    ],
    createDocumentState({ generation: 3, title: "Ledger", url: `${site}/article` }),
  ).state

  // The inert blank document then stops loading, which ends the restore without a commit.
  const settled = transitionDocument(held, { type: "loading.stopped", title: "Ledger" }).state

  for (const state of [held, settled]) {
    expect(documentTab(state, history)).toEqual({ ...history, url: `${site}/article`, title: "Ledger", loading: false, generation: 3 })

    for (const method of ["back", "forward", "stop"] as const) expect(leftApprovedSite(state, method, site, "about:blank")).toBe(false)

    // Reload loads the kept address, so it is that address's site which must be the approved one.
    expect(leftApprovedSite(state, "reload", site, "about:blank")).toBe(false)
    expect(leftApprovedSite(state, "reload", "https://other.test", "about:blank")).toBe(true)

    // Anything that would act on the blank document is still refused.
    for (const method of ["click", "evaluate", "snapshot"] as const) expect(leftApprovedSite(state, method, site, "about:blank")).toBe(true)
  }

  // So is history on a committed page of another site, or on a failed page that keeps an unissued address.
  const elsewhere = replay(visit("https://other.test/")).state
  expect(leftApprovedSite(elsewhere, "back", site, "https://other.test/")).toBe(true)
  expect(leftApprovedSite(replay(visit(`${site}/article`)).state, "back", site, `${site}/article`)).toBe(false)
  expect(leftApprovedSite(elsewhere, "back", undefined, "https://other.test/")).toBe(false)
  const failed = replay([{ type: "navigation.failed", url: "https://other.test/", isMainFrame: true, code: -105, description: "ERR_NAME_NOT_RESOLVED" }, { type: "navigation.held-stopped", address: `${site}/article` }], elsewhere).state
  expect(leftApprovedSite(failed, "back", site, "https://other.test/")).toBe(true)
})

test("a redraw after the capture request must still belong to its document and route", () => {
  const page = replay(visit("https://site.test/a")).state
  expect(frameStillCurrent(page, transitionDocument(page, { type: "title.updated", title: "Ready" }).state)).toBe(true)
  const next = transitionDocument(page, { type: "navigation.started", url: "https://site.test/b", isMainFrame: true, isSameDocument: false }).state
  expect(frameStillCurrent(page, next)).toBe(false)
  expect(frameStillCurrent(next, next)).toBe(false)
  expect(frameStillCurrent(page, replay(visit("https://site.test/a"), page).state)).toBe(false)
  expect(frameStillCurrent(page, transitionDocument(page, { type: "navigation.in-page", isMainFrame: true, url: "https://site.test/b", title: "B" }).state)).toBe(false)
  expect(frameStillCurrent(page, transitionDocument(page, { type: "disposed" }).state)).toBe(false)
  const failed = transitionDocument(page, { type: "navigation.failed", url: "https://site.test/a", isMainFrame: true, code: -2, description: "ERR_FAILED" }).state
  expect(frameStillCurrent(page, failed)).toBe(false)
  const restoring = createDocumentState({ generation: 1, title: "A", url: "https://site.test/a" })
  expect(frameStillCurrent(restoring, restoring)).toBe(false)
})

// The extension filter gate publishes its held navigation as a start and a spinner, and Stop during the wait ends it
// with a stop and no commit (navigation-turn.ts).
test("a redraw against the filter gate's held navigation: rejected while it is held, current again once it is cancelled", () => {
  const held: DocumentEvent[] = [
    { type: "navigation.started", url: "https://site.test/b", isMainFrame: true, isSameDocument: false },
    { type: "loading.started" },
  ]

  const page = replay(visit("https://site.test/a")).state
  const waiting = replay(held, page).state
  expect(isNavigationPending(waiting)).toBe(true)
  expect(frameStillCurrent(page, waiting)).toBe(false)
  // Never issued, so the page still shows the document the redraw drew.
  const cancelled = transitionDocument(waiting, { type: "loading.stopped", title: "https://site.test/a" }).state
  expect(isNavigationPending(cancelled)).toBe(false)
  expect(frameStillCurrent(page, cancelled)).toBe(true)
  expect(frameStillCurrent(page, replay(visit("https://site.test/b"), waiting).state)).toBe(false)

  // An actual native stop with no commit is distinct from stopping before Chromium starts the load.
  const restoring = createDocumentState({ generation: 1, title: "B", url: "https://site.test/b" })
  const blank = replay([...held, { type: "loading.stopped", title: "" }], restoring).state
  expect(blank.status).toBe("blank")
  expect(frameStillCurrent(blank, blank)).toBe(true)
  expect(frameStillCurrent(restoring, blank)).toBe(false)
})

test("Stop before issue publishes the restore address without inventing a committed document or an error", () => {
  const address = "https://next.test/report"
  const restore = createDocumentState({ url: address, title: "Report", generation: 4 })

  for (const before of [restore, replay(visit("https://previous.test/")).state, replay(visit("file:///workspace/report.html")).state]) {
    const cancelled = replay([
      { type: "navigation.started", isMainFrame: true, isSameDocument: false, url: address },
      { type: "loading.started" },
      { type: "navigation.held-stopped", address },
    ], before).state

    const saved = documentTab(cancelled, history)
    expect(saved).toMatchObject({ id: history.id, url: before.status === "loaded" ? before.url : address, loading: false })
    expect(saved).not.toHaveProperty("loadError")
    expect(documentVisible(cancelled)).toBe(documentVisible(before))
    expect(documentTab(cancelled, history, false)).toEqual(documentTab(before, history, false))
  }
})

// Electron's events for a navigation that commits and finishes loading.
const visit = (url: string, title = url): DocumentEvent[] => [
  { type: "navigation.started", url, isMainFrame: true, isSameDocument: false },
  { type: "loading.started" },
  { type: "navigation.committed", url, status: 200, title },
  { type: "document.ready" },
  { type: "loading.stopped", title },
]

// A new tab that loaded about:blank, then a shown page at generation 2 with an icon.
const shown = () =>
  replay([
    ...visit("about:blank", ""),
    ...visit("https://alpha.example/", "Alpha"),
    { type: "icon.updated", favicons: ["https://alpha.example/favicon.ico"] },
    { type: "icon.loaded", attempt: 3, icon: "data:image/png;base64,AA" },
  ]).state

test("a failed local history entry has no address to open, not the previous HTTP document", () => {
  const event = { type: "navigation.failed", url: "oc-preview://host/virtual", code: -2, description: "ERR_FAILED", isMainFrame: true } as const
  expect(documentTab(replay([event], shown()).state, history)).toMatchObject({ url: "about:blank", loadError: "ERR_FAILED" })
})

test("site controls are unavailable for a failed page showing a retry address until that address loads", () => {
  const url = "https://retry.test/"
  const failed = transitionDocument(shown(), { type: "navigation.failed", code: -324, description: "ERR_EMPTY_RESPONSE", url: "https://failed.test/", isMainFrame: true }).state
  const stopped = transitionDocument(failed, { type: "navigation.held-stopped", address: url })
  expect(documentTab(stopped.state, history).url).toBe(url)
  expect(retryOnly(stopped.state)).toBe(true)
  expect(types(stopped.effects)).toContain("detail")
  const loaded = replay(visit(url), stopped.state)
  expect(retryOnly(loaded.state)).toBe(false)
  expect(types(loaded.all)).toContain("detail")
})

test.each(["workspace://ses_a/report.html", "file:///work/report.html", "artifact://art_a/"])("a failed restore retains its verified retry address %s", (url) => {
  const event = { type: "navigation.failed", code: -2, description: "ERR_FAILED", url: "oc-preview://grant/report.html", preview: url, isMainFrame: true } as const
  expect(documentTab(replay([event], createDocumentState({ url, generation: 1, title: "Report" })).state, history)).toMatchObject({ url, loadError: "ERR_FAILED" })
  expect(documentTab(replay([event], shown()).state, history).url).toBe("about:blank")
})

describe("uncommitted navigations keep the document", () => {
  test("a download keeps the generation, refs and the shown page", () => {
    const start = shown()
    expect(documentGeneration(start)).toBe(2)

    const pending = replay(
      [
        {
          type: "navigation.started",
          url: "https://alpha.example/report.zip",
          isMainFrame: true,
          isSameDocument: false,
        },
        { type: "loading.started" },
      ],
      start,
    )

    expect(isDocumentLoading(pending.state)).toBe(true)
    expect(documentGeneration(pending.state)).toBe(2)

    const done = replay([{ type: "loading.stopped", title: "Alpha" }], pending.state)
    expect(isDocumentLoading(done.state)).toBe(false)
    expect(documentGeneration(done.state)).toBe(2)
    expect(documentVisible(done.state)).toBe(true)
    expect(types([...pending.all, ...done.all])).not.toContain("reset-document")
    expect(documentTab(done.state, history)).toMatchObject({ url: "https://alpha.example/", title: "Alpha" })
  })

  test("a blocked or cancelled navigation keeps the document", () => {
    const start = shown()

    const result = replay(
      [
        { type: "navigation.started", url: "https://blocked.example/", isMainFrame: true, isSameDocument: false },
        { type: "loading.started" },
        {
          type: "navigation.failed",
          code: -3,
          description: "ERR_ABORTED",
          url: "https://blocked.example/",
          isMainFrame: true,
        },
        { type: "loading.stopped", title: "Alpha" },
      ],
      start,
    )

    expect(types(result.all)).not.toContain("reset-document")
    expect(types(result.all)).not.toContain("show")
    expect(result.state).toMatchObject({
      status: "loaded",
      url: "https://alpha.example/",
      title: "Alpha",
      icon: "data:image/png;base64,AA",
      generation: 2,
      revealed: true,
    })
  })

  test("only the commit bumps the generation and resets the document", () => {
    const start = shown()

    const started = replay(
      [{ type: "navigation.started", url: "https://beta.example/", isMainFrame: true, isSameDocument: false }],
      start,
    )

    expect(types(started.effects)).toEqual(["clear-diagnostics", "publish"])
    expect(documentGeneration(started.state)).toBe(2)

    const committed = replay(
      [{ type: "navigation.committed", url: "https://beta.example/", status: 200, title: "beta" }],
      started.state,
    )

    expect(types(committed.effects)).toEqual(["reset-document", "publish", "detail"])
    expect(documentGeneration(committed.state)).toBe(3)
  })
})

test("a popup on about:blank is not loading until it navigates away", () => {
  const blank = replay([{ type: "loading.started" }]).state
  expect(blank.status).toBe("blank")
  expect(isDocumentLoading(blank)).toBe(false)

  const started = replay(
    [{ type: "navigation.started", url: "https://popup.example/", isMainFrame: true, isSameDocument: false }],
    blank,
  )

  expect(isDocumentLoading(started.state)).toBe(true)

  const committed = replay(
    [{ type: "navigation.committed", url: "https://popup.example/", status: 200, title: "" }],
    started.state,
  )

  expect(documentGeneration(committed.state)).toBe(1)
  expect(isDocumentLoading(committed.state)).toBe(true)
})

describe("failed documents", () => {
  const dead = () =>
    replay([
      ...visit("about:blank", ""),
      { type: "navigation.started", url: "https://dead.example/", isMainFrame: true, isSameDocument: false },
      { type: "loading.started" },
      {
        type: "navigation.failed",
        code: -102,
        description: "ERR_CONNECTION_REFUSED",
        url: "https://dead.example/",
        isMainFrame: true,
      },
      { type: "loading.stopped", title: "dead.example" },
    ]).state

  test("a stopped reload of a failed page never reveals Chromium's error page", () => {
    const start = dead()
    expect(documentTab(start, history).loadError).toBe("ERR_CONNECTION_REFUSED")

    const reloading = replay(
      [
        { type: "navigation.started", url: "https://dead.example/", isMainFrame: true, isSameDocument: false },
        { type: "loading.started" },
      ],
      start,
    )

    expect(documentTab(reloading.state, history).loading).toBe(true)
    expect(documentTab(reloading.state, history)).not.toHaveProperty("loadError")

    const stopped = replay(
      [
        {
          type: "navigation.failed",
          code: -3,
          description: "ERR_ABORTED",
          url: "https://dead.example/",
          isMainFrame: true,
        },
        { type: "loading.stopped", title: "dead.example" },
      ],
      reloading.state,
    )

    expect(documentTab(stopped.state, history)).toMatchObject({ loading: false, loadError: "ERR_CONNECTION_REFUSED" })
    expect(documentVisible(stopped.state)).toBe(false)
    expect(types([...reloading.all, ...stopped.all])).not.toContain("show")
  })

  test("the proxy's 502 stays failed and hidden through dom-ready and stop", () => {
    const result = replay([
      ...visit("https://alpha.example/", "Alpha"),
      { type: "navigation.started", url: "https://alpha.example/down", isMainFrame: true, isSameDocument: false },
      {
        type: "navigation.committed",
        url: "https://alpha.example/down",
        status: 502,
        title: "",
      },
      { type: "document.ready" },
      { type: "loading.stopped", title: "" },
    ])

    expect(result.state.status).toBe("failed")
    expect(documentVisible(result.state)).toBe(false)
    expect(documentTab(result.state, history).loadError).toBe("502")
    expect(result.all.filter((effect) => effect.type === "show")).toEqual([
      { type: "show", visible: true },
      { type: "show", visible: false },
    ])
  })

  test("a failure after the commit keeps the committed generation", () => {
    const result = replay([
      ...visit("https://alpha.example/", "Alpha"),
      { type: "navigation.started", url: "https://alpha.example/next", isMainFrame: true, isSameDocument: false },
      { type: "navigation.committed", url: "https://alpha.example/next", status: 200, title: "" },
      {
        type: "navigation.failed",
        code: -2,
        description: "ERR_FAILED",
        url: "https://alpha.example/next",
        isMainFrame: true,
      },
    ])

    expect(result.state.status).toBe("failed")
    expect(documentGeneration(result.state)).toBe(2)
    expect(types(result.effects)).toEqual(["show", "publish"])
  })

  test("a failed subframe does not replace the page", () => {
    const start = shown()

    const result = transitionDocument(start, {
      type: "navigation.failed",
      code: -105,
      description: "ERR_NAME_NOT_RESOLVED",
      url: "https://ads.example/",
      isMainFrame: false,
    })

    expect(result.state).toBe(start)
    expect(result.effects).toEqual([])
  })
})

describe("restored tabs", () => {
  const restore = { url: "https://alpha.example/", title: "Alpha", generation: 4 }

  test("the first commit consumes the reserved generation", () => {
    const start = createDocumentState(restore)
    expect(documentTab(start, history)).toMatchObject({ url: "https://alpha.example/", generation: 4, loading: false })

    const events = visit("https://alpha.example/", "Alpha")

    expect(events.map((_, index) => documentGeneration(replay(events.slice(0, index + 1), start).state))).toEqual([
      4, 4, 4, 4, 4,
    ])

    const loaded = replay(events, start).state
    expect(documentGeneration(replay(visit("https://alpha.example/b"), loaded).state)).toBe(5)
  })

  test("a failed first load consumes it too", () => {
    const result = replay(
      [
        { type: "navigation.started", url: "https://alpha.example/", isMainFrame: true, isSameDocument: false },
        {
          type: "navigation.failed",
          code: -102,
          description: "ERR_CONNECTION_REFUSED",
          url: "https://alpha.example/",
          isMainFrame: true,
        },
      ],
      createDocumentState(restore),
    )

    expect(result.state).toMatchObject({ status: "failed", generation: 4, url: "https://alpha.example/" })
  })
})

describe("title and icon", () => {
  test("the same site keeps its title and icon until the new document names itself", () => {
    const start = shown()

    const committed = transitionDocument(start, {
      type: "navigation.committed",
      url: "https://alpha.example/next",
      status: 200,
      title: "alpha.example/next",
    }).state

    expect(committed).toMatchObject({ title: "Alpha", icon: "data:image/png;base64,AA" })
    expect(transitionDocument(committed, { type: "title.updated", title: "Next" }).state).toMatchObject({
      title: "Next",
    })
  })

  test("another site drops the icon and ignores the earlier site's slow fetch", () => {
    const pending = replay([{ type: "icon.updated", favicons: ["https://alpha.example/new.ico"] }], shown()).state

    const committed = replay(
      [
        { type: "navigation.started", url: "https://beta.example/", isMainFrame: true, isSameDocument: false },
        {
          type: "navigation.committed",
          url: "https://beta.example/",
          status: 200,
          title: "beta.example",
        },
      ],
      pending,
    ).state

    expect(committed).toMatchObject({ title: "beta.example", icon: undefined })
    const late = transitionDocument(committed, { type: "icon.loaded", attempt: 3, icon: "data:image/png;base64,BB" })
    expect(late.state).toBe(committed)
    expect(late.effects).toEqual([])
  })
})

test("a disposed document ignores every later event", () => {
  const closed = transitionDocument(shown(), { type: "disposed" }).state
  expect(closed.status).toBe("closed")

  const events: DocumentEvent[] = [
    ...visit("https://beta.example/"),
    { type: "icon.loaded", attempt: 2, icon: undefined },
    { type: "title.updated", title: "Beta" },
  ]

  events.forEach((event) => {
    const next = transitionDocument(closed, event)
    expect(next.state).toBe(closed)
    expect(next.effects).toEqual([])
  })
})

describe("a screenshot waits for a pending navigation", () => {
  const start = (url: string): DocumentEvent => ({
    type: "navigation.started",
    url,
    isMainFrame: true,
    isSameDocument: false,
  })

  test("a main-frame navigation is pending until it commits", () => {
    const pending = replay([start("https://alpha.example/login"), { type: "loading.started" }], shown())
    expect(isNavigationPending(pending.state)).toBe(true)

    const redirected = replay([start("https://beta.example/home")], pending.state)
    expect(isNavigationPending(redirected.state)).toBe(true)

    const committed = replay(
      [
        {
          type: "navigation.committed",
          url: "https://beta.example/home",
          status: 200,
          title: "Home",
        },
      ],
      redirected.state,
    )

    expect(isNavigationPending(committed.state)).toBe(false)
  })

  test("a failed, cancelled or downloaded navigation stops being pending", () => {
    const failed = replay(
      [
        start("https://gone.example/"),
        {
          type: "navigation.failed",
          code: -105,
          description: "ERR_NAME_NOT_RESOLVED",
          url: "https://gone.example/",
          isMainFrame: true,
        },
      ],
      shown(),
    )

    expect(isNavigationPending(failed.state)).toBe(false)

    const download = replay(
      [
        start("https://alpha.example/report.zip"),
        { type: "loading.started" },
        { type: "loading.stopped", title: "Alpha" },
      ],
      shown(),
    )

    expect(isNavigationPending(download.state)).toBe(false)
  })

  test("same-document and subframe navigations and closed pages are never pending", () => {
    const local = replay(
      [
        { type: "navigation.started", url: "https://alpha.example/#top", isMainFrame: true, isSameDocument: true },
        { type: "navigation.started", url: "https://ads.example/", isMainFrame: false, isSameDocument: false },
      ],
      shown(),
    )

    expect(isNavigationPending(local.state)).toBe(false)

    const closed = replay([start("https://beta.example/"), { type: "disposed" }], shown())
    expect(isNavigationPending(closed.state)).toBe(false)
  })
})
