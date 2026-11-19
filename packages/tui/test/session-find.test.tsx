import { describe, expect, test } from "bun:test"
import { InputRenderable, RGBA, TextareaRenderable, type TextChunk } from "@opentui/core"
import type { SessionMessageInfo } from "@opencode/client"
import {
  displayRanges,
  findMatches,
  findParts,
  findPattern,
  findRanges,
  offsetRow,
  paintChunks,
} from "../src/routes/session/find"
import type { SessionRow } from "../src/routes/session/rows"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const chunk = (text: string): TextChunk => ({ __isChunk: true, text })

describe("find", () => {
  test("matches plain text without case, ignoring surrounding whitespace", () => {
    expect(findPattern("   ")).toBeUndefined()
    expect(findRanges("Needle, needle, NEEDLE", findPattern(" needle "))).toEqual([
      { start: 0, end: 6 },
      { start: 8, end: 14 },
      { start: 16, end: 22 },
    ])
    // Regex syntax is literal, and occurrences do not overlap.
    expect(findRanges("a.b axb (x)", findPattern("a.b"))).toEqual([{ start: 0, end: 3 }])
    expect(findRanges("call (x) now", findPattern("(x)"))).toEqual([{ start: 5, end: 8 }])
    expect(findRanges("aaaa", findPattern("aa"))).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
    // Case changes keep the same pattern source, so the current match survives them.
    expect(findPattern("Needle")?.source).toBe(findPattern("needle")?.source)
  })

  test("searches prompts and assistant text in transcript order, not reasoning or tools", () => {
    const messages: Record<string, SessionMessageInfo> = {
      u1: { id: "u1", type: "user", text: "find the needle", time: { created: 1 } } as SessionMessageInfo,
      a1: {
        id: "a1",
        type: "assistant",
        content: [
          { type: "reasoning", text: "needle in my thoughts" },
          { type: "text", text: "  first needle  " },
          { type: "tool", id: "tool-1", name: "grep", state: { status: "completed", input: { pattern: "needle" } } },
          { type: "text", text: "second needle" },
        ],
      } as unknown as SessionMessageInfo,
    }
    const rows = [
      { type: "message", messageID: "u1" },
      { type: "part", ref: { messageID: "a1", partID: "reasoning:0" } },
      { type: "part", ref: { messageID: "a1", partID: "text:0" } },
      { type: "part", ref: { messageID: "a1", partID: "tool-1" } },
      { type: "part", ref: { messageID: "a1", partID: "text:1" } },
    ] satisfies SessionRow[]
    const parts = findParts(rows, (id) => messages[id])
    expect(parts).toEqual([
      { messageID: "u1", partID: "message", text: "find the needle" },
      { messageID: "a1", partID: "text:0", text: "first needle" },
      { messageID: "a1", partID: "text:1", text: "second needle" },
    ])
    expect(findMatches(parts, findPattern("needle")).map((match) => match.partID)).toEqual([
      "message",
      "text:0",
      "text:1",
    ])
  })

  test("maps source matches onto concealed markdown chunks", () => {
    // `**bold** text` renders as "bold text": the asterisks have no chunk.
    const chunks = [chunk("bold"), chunk(" text")]
    const sources = [
      { start: 2, end: 6 },
      { start: 8, end: 13 },
    ]
    expect(displayRanges(chunks, sources, [{ start: 9, end: 13 }])).toEqual([{ start: 5, end: 9 }])
    // A match over the markers covers only what is shown.
    expect(displayRanges(chunks, sources, [{ start: 0, end: 8 }])).toEqual([{ start: 0, end: 4 }])
    expect(displayRanges(chunks, sources, [{ start: 6, end: 8 }])).toEqual([])
    expect(displayRanges(chunks, sources.slice(1), [{ start: 0, end: 4 }])).toEqual([])
  })

  test("paints ranges across chunk boundaries", () => {
    const bg = RGBA.fromHex("#ff0000")
    const painted = paintChunks([chunk("Hello "), chunk("world")], [{ start: 4, end: 8 }], (piece) => ({
      ...piece,
      bg,
    }))
    expect(painted.map((piece) => [piece.text, piece.bg === bg])).toEqual([
      ["Hell", false],
      ["o ", true],
      ["wo", true],
      ["rld", false],
    ])
  })

  test("finds the wrapped row that shows an offset", () => {
    const text = "alpha beta gamma\nsecond"
    // Wrapped at 11 columns: "alpha beta " | "gamma" | "second".
    const info = {
      lineStartCols: [0, 11, 17],
      lineWidthCols: [11, 5, 6],
      lineWidthColsMax: 11,
      lineSources: [0, 0, 1],
      lineWraps: [0, 1, 0],
    }
    expect(offsetRow(info, text, text.indexOf("beta"))).toBe(0)
    expect(offsetRow(info, text, text.indexOf("gamma"))).toBe(1)
    expect(offsetRow(info, text, text.indexOf("second"))).toBe(2)
  })
})

test("Find highlights prompts and markdown, moves between matches, and clears on close", async () => {
  const sessionID = "ses_find"
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const model = { providerID: "demo", id: "model" }
  const filler = Array.from({ length: 16 }, (_, index) => ({
    id: `message-${String(index + 2).padStart(2, "0")}`,
    type: "user",
    text: `Filler message ${index}`,
    time: { created: index + 10 },
  }))
  const messages = [
    { id: "message-00", type: "user", text: "Where is the needle?", time: { created: 1 } },
    {
      id: "message-01",
      type: "assistant",
      agent: "build",
      model,
      finish: "stop",
      time: { created: 2, completed: 3 },
      content: [{ type: "text", text: "The **Needle** is in the code:\n\n```ts\nconst needle = 1\n```\n\n| a | b |\n|---|---|\n| hay | needle |" }],
    },
    ...filler,
    { id: "message-99", type: "user", text: "Last needle here", time: { created: 99 } },
  ]
  await using app = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" }, experimental: { "session-find": true } },
    fetch: async (url) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "project",
            title: "Find fixture",
            agent: "build",
            model,
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      return undefined
    },
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("Last needle here") && frame.includes("Demo Model"))
  expect(app.captureCharFrame()).not.toContain("Where is the needle?")

  // Painted matches: spans that read "needle" on a background their line's preceding span lacks.
  const painted = () =>
    app.captureSpans().lines.flatMap((line) =>
      line.spans.flatMap((span, index) => {
        const before = line.spans[index - 1]
        return span.text.toLowerCase() === "needle" && before && !before.bg.equals(span.bg) ? [span.text] : []
      }),
    )

  app.mockInput.pressKey("x", { ctrl: true })
  app.mockInput.pressKey("f")
  // Find takes the prompt's place.
  await app.waitForFrame(
    (frame) =>
      frame.includes("Find in session...") &&
      frame.includes("shift+enter previous") &&
      !frame.includes("Demo Model") &&
      app.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await app.mockInput.typeText("needle")
  // The first match is the oldest, so the transcript scrolls up to it.
  await app.waitForFrame((frame) => frame.includes("1/5") && frame.includes("Where is the needle?"))
  await app.waitFor(() => painted().length === 4)
  expect(painted()).toEqual(["needle", "Needle", "needle", "needle"])

  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("2/5"))
  app.mockInput.pressArrow("up")
  app.mockInput.pressArrow("up")
  await app.waitForFrame((frame) => frame.includes("5/5") && frame.includes("Last needle here"))

  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("shift+enter previous") && frame.includes("Demo Model"))
  // The prompt comes back with focus.
  await app.waitFor(() => {
    const focused = app.renderer.currentFocusedRenderable
    return focused instanceof TextareaRenderable && !(focused instanceof InputRenderable)
  })
  await app.waitFor(() => painted().length === 0)
})
