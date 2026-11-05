import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  createDocumentState,
  documentGeneration,
  documentTab,
  documentVisible,
  isDocumentLoading,
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

// Electron's events for a navigation that commits and finishes loading.
const visit = (url: string, title = url): DocumentEvent[] => [
  { type: "navigation.started", url, isMainFrame: true, isSameDocument: false },
  { type: "loading.started" },
  { type: "navigation.committed", url, status: 200, statusText: "OK", title },
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
      [{ type: "navigation.committed", url: "https://beta.example/", status: 200, statusText: "OK", title: "beta" }],
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
    [{ type: "navigation.committed", url: "https://popup.example/", status: 200, statusText: "OK", title: "" }],
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
        statusText: "Bad Gateway",
        title: "",
      },
      { type: "document.ready" },
      { type: "loading.stopped", title: "" },
    ])

    expect(result.state.status).toBe("failed")
    expect(documentVisible(result.state)).toBe(false)
    expect(documentTab(result.state, history).loadError).toBe("502 Bad Gateway")
    expect(result.all.filter((effect) => effect.type === "show")).toEqual([
      { type: "show", visible: true },
      { type: "show", visible: false },
    ])
  })

  test("a failure after the commit keeps the committed generation", () => {
    const result = replay([
      ...visit("https://alpha.example/", "Alpha"),
      { type: "navigation.started", url: "https://alpha.example/next", isMainFrame: true, isSameDocument: false },
      { type: "navigation.committed", url: "https://alpha.example/next", status: 200, statusText: "OK", title: "" },
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
      statusText: "OK",
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
          statusText: "OK",
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
