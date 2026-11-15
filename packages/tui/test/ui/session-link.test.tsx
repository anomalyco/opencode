/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { CodeRenderable, SyntaxStyle, TextAttributes, type MarkdownRenderable, type Renderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup, onMount, type JSX } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { RouteProvider, useRoute } from "../../src/context/route"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider } from "../../src/context/storage"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { useSessionLinks } from "../../src/ui/session-link"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createFetch, directory, json } from "../fixture/tui-client"
import { waitForHighlightedFrame } from "../fixture/frame"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const session = (id: string, title: string, archived?: number) => ({
  id,
  title,
  projectID: "project",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0, ...(archived === undefined ? {} : { archived }) },
})
const id = (name: string) => `ses_${name.repeat(26).slice(0, 26)}`
const current = id("current")
const known = session(id("known"), "Fix the flaky reconnect test on Windows")
const archived = session(id("archived"), "Old work", 1)
const unknown = id("unknown")
const missing = id("missing")

test.each(["top-level", "coalesced"] as const)("session links in %s markdown", async (mode) => {
  await using state = await tmpdir()
  const lookup = Promise.withResolvers<void>()
  const requested: string[] = []
  const fetched = new Map([missing, unknown].map((sessionID) => [sessionID, Promise.withResolvers<void>()]))
  const calls = createFetch(async (url) => {
    const sessionID = url.pathname.match(/^\/api\/session\/(ses_\w+)$/)?.[1]
    if (!sessionID) return
    requested.push(sessionID)
    fetched.get(sessionID)?.resolve()
    if (sessionID === unknown) return lookup.promise.then(() => json({ data: session(unknown, "Looked up") }))
    return json(
      { _tag: "SessionNotFoundError", sessionID, message: `Session not found: ${sessionID}` },
      { status: 404 },
    )
  })
  let data!: ReturnType<typeof useData>
  let route!: ReturnType<typeof useRoute>

  function Transcript() {
    data = useData()
    route = useRoute()
    data.session.remember({ ...known })
    data.session.remember({ ...archived })
    const renderer = useRenderer()
    const syntaxStyle = SyntaxStyle.fromStyles(
      { default: { fg: "#ffffff" }, "markup.link.url": { fg: "#00ff00" } },
      renderer.nativeScene,
    )
    onCleanup(() => syntaxStyle.destroy())
    return (
      <markdown
        ref={useSessionLinks()}
        internalBlockMode={mode}
        syntaxStyle={syntaxStyle}
        content={[
          `**中文** see ${known.id} now`,
          "",
          `- current ${current}`,
          `- archived ${archived.id}`,
          `- unknown ${unknown}`,
          `- missing ${missing}`,
          "",
          "```",
          known.id,
          "```",
        ].join("\n")}
      />
    )
  }

  const app = await mount(state.path, calls.fetch, () => <Transcript />, 40, 16)
  // Highlighting runs on the tree-sitter worker and lookups on the fixture server.
  const linked = () =>
    app
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.attributes & TextAttributes.UNDERLINE)
      .map((span) => span.text.trim())
      .join(" ")

  try {
    await Promise.all([...fetched.values()].map((request) => request.promise))
    // The client marks the session missing once it has read the 404.
    await app.waitFor(() => data.session.missing(missing))
    await waitForHighlightedFrame(app, () => linked().length > 0)
    const frame = app.captureCharFrame()
    // The long title wraps; the current, archived, missing and still-loading sessions stay IDs.
    expect(linked()).toBe("@Fix the flaky reconnect test on Windows")
    for (const plain of [current, archived.id, unknown, missing, known.id]) expect(frame).toContain(plain)
    expect(requested.toSorted()).toEqual([missing, unknown])

    lookup.resolve()
    // Joins the lookup already in flight rather than fetching again.
    await data.session.sync(unknown)
    await waitForHighlightedFrame(app, () => linked().includes("@Looked up"))
    data.session.remember({ ...known, title: "Renamed" })
    await waitForHighlightedFrame(app, () => linked() === "@Renamed @Looked up")
    // Lookups are cached, misses included.
    expect(requested.toSorted()).toEqual([missing, unknown])

    const rows = app.captureCharFrame().split("\n")
    const clicked = rows.findIndex((row) => row.includes("@Looked up"))
    app.renderer.clearSelection()
    await app.mockMouse.click(rows[clicked]!.indexOf("@Looked up") + 4, clicked)
    expect(route.data).toEqual({ type: "session", sessionID: unknown })
  } finally {
    app.renderer.destroy()
  }
})

test("a wrapped title opens its session from either row, and plain text does not", async () => {
  await using state = await tmpdir()
  const calls = createFetch(async () => undefined)
  let route!: ReturnType<typeof useRoute>

  function Transcript() {
    useData().session.remember({ ...known })
    route = useRoute()
    const renderer = useRenderer()
    const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, renderer.nativeScene)
    onCleanup(() => syntaxStyle.destroy())
    return (
      <markdown
        ref={useSessionLinks()}
        internalBlockMode="top-level"
        syntaxStyle={syntaxStyle}
        content={`**中文** see ${known.id} now`}
      />
    )
  }

  const app = await mount(state.path, calls.fetch, () => <Transcript />, 30, 6)

  try {
    await waitForHighlightedFrame(app, (frame) => frame.includes("@Fix"))
    const rows = app.captureCharFrame().split("\n")
    const head = rows.findIndex((row) => row.includes("@Fix"))
    const tail = rows.findIndex((row) => row.includes("Windows"))
    expect(tail).toBeGreaterThan(head)

    await app.mockMouse.click(rows[head]!.indexOf("see"), head)
    await app.mockMouse.click(rows[tail]!.indexOf("now"), tail)
    await app.mockMouse.drag(rows[head]!.indexOf("@Fix"), head, rows[head]!.indexOf("@Fix") + 3, head)
    expect(route.data).toEqual({ type: "session", sessionID: current })

    app.renderer.clearSelection()
    await app.mockMouse.click(rows[tail]!.indexOf("Windows") + 2, tail)
    expect(route.data).toEqual({ type: "session", sessionID: known.id })
  } finally {
    app.renderer.destroy()
  }
})

test("clicking a session link in a dialog closes it and opens the session", async () => {
  await using state = await tmpdir()
  const calls = createFetch(async () => undefined)
  let route!: ReturnType<typeof useRoute>
  let dialog!: ReturnType<typeof useDialog>

  function Answer() {
    const renderer = useRenderer()
    const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, renderer.nativeScene)
    onCleanup(() => syntaxStyle.destroy())
    return <markdown ref={useSessionLinks()} syntaxStyle={syntaxStyle} content={`See ${known.id}`} />
  }
  function Probe() {
    useData().session.remember({ ...known })
    route = useRoute()
    dialog = useDialog()
    onMount(() => dialog.replace(() => <Answer />))
    return null
  }

  const app = await mount(state.path, calls.fetch, () => <Probe />, 80, 12)

  try {
    await waitForHighlightedFrame(app, (frame) => frame.includes("@Fix"))
    const rows = app.captureCharFrame().split("\n")
    const y = rows.findIndex((row) => row.includes("@Fix"))
    await app.mockMouse.click(rows[y]!.indexOf("@Fix") + 2, y)
    expect(route.data).toEqual({ type: "session", sessionID: known.id })
    expect(dialog.stack).toHaveLength(0)
  } finally {
    app.renderer.destroy()
  }
})

test.each([true, false])("code spans link only when they are exactly an ID, conceal %p", async (conceal) => {
  await using state = await tmpdir()
  const calls = createFetch(async () => undefined)

  function Transcript() {
    useData().session.remember({ ...known })
    const renderer = useRenderer()
    const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, renderer.nativeScene)
    onCleanup(() => syntaxStyle.destroy())
    return (
      <markdown
        ref={useSessionLinks()}
        internalBlockMode="top-level"
        conceal={conceal}
        syntaxStyle={syntaxStyle}
        content={`Run \`opencode --session ${known.id}\` or open \`${known.id}\`.`}
      />
    )
  }

  const app = await mount(state.path, calls.fetch, () => <Transcript />, 120, 4)
  const linked = () =>
    app
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.attributes & TextAttributes.UNDERLINE)
      .map((span) => span.text.trim())

  try {
    await waitForHighlightedFrame(app, () => linked().length > 0)
    expect(linked()).toEqual([conceal ? `@${known.title}` : known.id])
    expect(app.captureCharFrame()).toContain(`opencode --session ${known.id}`)
  } finally {
    app.renderer.destroy()
  }
})

test("a label change re-highlights only the blocks that mention that session", async () => {
  await using state = await tmpdir()
  const calls = createFetch(async () => undefined)
  const other = session(id("other"), "Other work")
  let data!: ReturnType<typeof useData>
  let markdown!: MarkdownRenderable

  function Transcript() {
    data = useData()
    data.session.remember({ ...known })
    data.session.remember({ ...other })
    const links = useSessionLinks()
    const renderer = useRenderer()
    const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, renderer.nativeScene)
    onCleanup(() => syntaxStyle.destroy())
    return (
      <markdown
        ref={(renderable: MarkdownRenderable) => {
          links(renderable)
          markdown = renderable
        }}
        internalBlockMode="top-level"
        syntaxStyle={syntaxStyle}
        content={`First ${known.id}\n\nSecond ${other.id}`}
      />
    )
  }

  const app = await mount(state.path, calls.fetch, () => <Transcript />, 80, 6)

  try {
    await waitForHighlightedFrame(app, (frame) => frame.includes("@Fix") && frame.includes("@Other"))
    // Record which blocks get their chunk callback reset, the refresh's re-highlight trigger.
    const reset: string[] = []
    const descriptor = Object.getOwnPropertyDescriptor(CodeRenderable.prototype, "onChunks")!
    const blocks = (renderable: Renderable): CodeRenderable[] => [
      ...(renderable instanceof CodeRenderable ? [renderable] : []),
      ...renderable.getChildren().flatMap(blocks),
    ]
    blocks(markdown).forEach((block) =>
      Object.defineProperty(block, "onChunks", {
        configurable: true,
        get: () => descriptor.get!.call(block),
        set: (value) => {
          reset.push(block.plainText)
          descriptor.set!.call(block, value)
        },
      }),
    )

    data.session.remember({ ...known, title: "Renamed" })
    await waitForHighlightedFrame(app, (frame) => frame.includes("@Renamed"))
    expect(reset.length).toBeGreaterThan(0)
    expect(reset.every((text) => text.startsWith("First"))).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

async function mount(
  state: string,
  fetch: typeof globalThis.fetch,
  view: () => JSX.Element,
  width: number,
  height: number,
) {
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ConfigProvider config={createTuiResolvedConfig()}>
              <Keymap.Provider>
                <ToastProvider>
                  <RouteProvider initialRoute={{ type: "session", sessionID: current }}>
                    <ClientProvider api={createApi(fetch)}>
                      <DataProvider directory={directory}>
                        <ThemeProvider mode="dark" source={emptyThemeSource}>
                          <DialogProvider>{view()}</DialogProvider>
                        </ThemeProvider>
                      </DataProvider>
                    </ClientProvider>
                  </RouteProvider>
                </ToastProvider>
              </Keymap.Provider>
            </ConfigProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width, height },
  )
  // Frame waits need the render loop; highlights and lookups land between frames.
  app.renderer.start()
  return app
}
