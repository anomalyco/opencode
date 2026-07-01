import { describe, test, expect, afterEach } from "bun:test"
import { render } from "solid-js/web"
import { EditorState, Text } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { CompletionContext } from "@codemirror/autocomplete"
import { CodeEditor } from "./code-editor"
import {
  offsetToPos,
  posToOffset,
  mapDiagnostics,
  createCompletionSource,
  normalizeCompletionItems,
  hoverContentsToText,
  severityToCM,
  firstDefinition,
  uriToPath,
  lspExtensions,
  type LspClient,
  type LspExtensionsOptions,
} from "./code-editor-lsp"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function mockLsp(overrides: Partial<LspClient> = {}): LspClient {
  return {
    buffer: async () => true,
    bufferClose: async () => true,
    completion: async () => [],
    hover: async () => null,
    definition: async () => [],
    diagnostics: async () => [],
    ...overrides,
  }
}

function baseOpts(over: Partial<LspExtensionsOptions> = {}): LspExtensionsOptions {
  let v = 0
  return {
    path: "src/foo.ts",
    bumpVersion: () => ++v,
    lsp: mockLsp(),
    onOpenLocation: () => {},
    subscribeDiagnostics: () => () => {},
    debounceMs: 10,
    ...over,
  }
}

describe("offset <-> position helpers", () => {
  test("round-trips on a simple multi-line doc", () => {
    const doc = Text.of(["hello", "world", "abc"])
    for (let offset = 0; offset <= doc.length; offset++) {
      const pos = offsetToPos(doc, offset)
      expect(posToOffset(doc, pos)).toBe(offset)
    }
  })

  test("handles multi-byte (UTF-16) characters", () => {
    const doc = Text.of(["café", "naïve héllo"])
    // 'é' is a single UTF-16 code unit; offsets are code-unit based.
    expect(offsetToPos(doc, 4)).toEqual({ line: 0, character: 4 })
    expect(posToOffset(doc, { line: 0, character: 4 })).toBe(4)
    // start of second line
    const secondLine = doc.line(2)
    expect(offsetToPos(doc, secondLine.from)).toEqual({ line: 1, character: 0 })
  })

  test("CRLF: line breaks are not addressable, positions stay per-line", () => {
    const doc = Text.of(["a", "b"]) // CM normalizes content; line break length is 1 here
    expect(offsetToPos(doc, 0)).toEqual({ line: 0, character: 0 })
    expect(offsetToPos(doc, 2)).toEqual({ line: 1, character: 0 })
  })

  test("clamps out-of-range input", () => {
    const doc = Text.of(["ab"])
    expect(offsetToPos(doc, 999)).toEqual({ line: 0, character: 2 })
    expect(posToOffset(doc, { line: 99, character: 99 })).toBe(2)
  })
})

describe("severity mapping", () => {
  test("maps 1..4", () => {
    expect(severityToCM(1)).toBe("error")
    expect(severityToCM(2)).toBe("warning")
    expect(severityToCM(3)).toBe("info")
    expect(severityToCM(4)).toBe("info")
    expect(severityToCM(undefined)).toBe("error")
  })
})

describe("mapDiagnostics", () => {
  test("maps ranges to CM offsets", () => {
    const doc = Text.of(["const x = 1", "let y = 2"])
    const cm = mapDiagnostics(doc, [
      {
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        severity: 1,
        message: "oops",
        source: "ts",
      },
    ])
    expect(cm).toHaveLength(1)
    expect(cm[0]).toMatchObject({ from: 6, to: 7, severity: "error", message: "oops", source: "ts" })
  })

  test("swaps reversed ranges and skips rangeless entries", () => {
    const doc = Text.of(["abcdef"])
    const cm = mapDiagnostics(doc, [
      { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 2 } }, message: "rev" },
      { message: "norange" } as any,
    ])
    expect(cm).toHaveLength(1)
    expect(cm[0]).toMatchObject({ from: 2, to: 4 })
  })
})

describe("completion source", () => {
  function makeContext(docLines: string[], pos: number, explicit = true) {
    const state = EditorState.create({ doc: docLines.join("\n") })
    return new CompletionContext(state, pos, explicit)
  }

  // Helper: the per-client array shape (real wire format) wrapping a CompletionList.
  const bump = () => 1

  test("calls lsp.completion and maps a bare CompletionItem[]", async () => {
    let received: any
    const source = createCompletionSource({
      path: "src/foo.ts",
      bumpVersion: bump,
      lsp: mockLsp({
        completion: async (input) => {
          received = input
          return [
            { label: "foo", detail: "fn foo", insertText: "foo()", kind: 3 },
            { label: "bar" },
          ]
        },
      }),
    })
    const ctx = makeContext(["fo"], 2)
    const result = await source(ctx)
    expect(received).toMatchObject({ path: "src/foo.ts", line: 0, character: 2 })
    expect(result).not.toBeNull()
    expect(result!.options).toHaveLength(2)
    expect(result!.options[0]).toMatchObject({ label: "foo", detail: "fn foo", apply: "foo()" })
    expect(result!.options[1]).toMatchObject({ label: "bar", apply: "bar" })
  })

  test("handles the per-client array shape [{isIncomplete,items}]", async () => {
    const source = createCompletionSource({
      path: "x.ts",
      bumpVersion: bump,
      lsp: mockLsp({
        completion: async () => [{ isIncomplete: false, items: [{ label: "baz" }, { label: "qux" }] }] as any,
      }),
    })
    const result = await source(makeContext(["b"], 1))
    expect(result!.options.map((o) => o.label)).toEqual(["baz", "qux"])
  })

  test("flattens items across multiple per-client CompletionLists", async () => {
    const source = createCompletionSource({
      path: "x.py",
      bumpVersion: bump,
      lsp: mockLsp({
        completion: async () =>
          [
            { isIncomplete: false, items: [{ label: "pyright1" }] },
            { isIncomplete: false, items: [{ label: "ty1" }] },
          ] as any,
      }),
    })
    const result = await source(makeContext(["b"], 1))
    expect(result!.options.map((o) => o.label)).toEqual(["pyright1", "ty1"])
  })

  test("handles a bare CompletionList {items} shape", async () => {
    const source = createCompletionSource({
      path: "x.ts",
      bumpVersion: bump,
      lsp: mockLsp({ completion: async () => ({ items: [{ label: "baz" }] }) as any }),
    })
    const result = await source(makeContext(["b"], 1))
    expect(result!.options[0].label).toBe("baz")
  })

  test("returns null when no items", async () => {
    const source = createCompletionSource({
      path: "x.ts",
      bumpVersion: bump,
      lsp: mockLsp({ completion: async () => [] }),
    })
    expect(await source(makeContext(["b"], 1))).toBeNull()
  })

  test("flushes the buffer (awaited) BEFORE calling lsp.completion", async () => {
    const calls: string[] = []
    let bufferResolved = false
    const source = createCompletionSource({
      path: "src/foo.ts",
      bumpVersion: () => 7,
      lsp: mockLsp({
        buffer: async (input) => {
          calls.push("buffer")
          expect(input).toMatchObject({ path: "src/foo.ts", version: 7 })
          await sleep(5)
          bufferResolved = true
          return true
        },
        completion: async () => {
          // completion must only run after buffer has fully resolved
          expect(bufferResolved).toBe(true)
          calls.push("completion")
          return [{ label: "ok" }]
        },
      }),
    })
    const result = await source(makeContext(["fo.x"], 4))
    expect(calls).toEqual(["buffer", "completion"])
    expect(result!.options[0].label).toBe("ok")
  })

  test("normalizeCompletionItems handles all shapes and garbage", () => {
    // bare CompletionItem[]
    expect(normalizeCompletionItems([{ label: "a" }])).toHaveLength(1)
    // bare CompletionList
    expect(normalizeCompletionItems({ items: [{ label: "a" }] })).toHaveLength(1)
    // per-client array wrapping a CompletionList
    expect(normalizeCompletionItems([{ isIncomplete: false, items: [{ label: "a" }, { label: "b" }] }])).toHaveLength(2)
    // per-client array wrapping bare CompletionItem[] per client
    expect(normalizeCompletionItems([[{ label: "a" }], [{ label: "b" }]])).toHaveLength(2)
    expect(normalizeCompletionItems(null)).toHaveLength(0)
    expect(normalizeCompletionItems("garbage")).toHaveLength(0)
  })
})

describe("hover contents", () => {
  test("string", () => {
    expect(hoverContentsToText("hi")).toBe("hi")
  })
  test("MarkupContent", () => {
    expect(hoverContentsToText({ kind: "markdown", value: "**x**" })).toBe("**x**")
  })
  test("array", () => {
    expect(hoverContentsToText(["a", { value: "b" }])).toBe("a\n\nb")
  })
})

describe("definition", () => {
  test("uriToPath strips file:// and decodes", () => {
    expect(uriToPath("file:///home/u/my%20file.ts")).toBe("/home/u/my file.ts")
    expect(uriToPath("src/rel.ts")).toBe("src/rel.ts")
  })
  test("firstDefinition takes first Location", () => {
    const out = firstDefinition([
      { uri: "file:///a.ts", range: { start: { line: 2, character: 3 }, end: { line: 2, character: 4 } } },
    ])
    expect(out).toEqual({ path: "/a.ts", pos: { line: 2, character: 3 } })
  })
  test("firstDefinition handles LocationLink", () => {
    const out = firstDefinition({
      targetUri: "file:///b.ts",
      targetSelectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
    })
    expect(out).toEqual({ path: "/b.ts", pos: { line: 1, character: 0 } })
  })
  test("firstDefinition returns undefined for empty", () => {
    expect(firstDefinition([])).toBeUndefined()
  })
})

// --- Integration against a live EditorView (buffer sync + teardown) ---------

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function mountEditor(opts: LspExtensionsOptions, value = "hello") {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => CodeEditor({ value, path: opts.path, extensions: lspExtensions(opts) }), host)
  cleanups.push(() => {
    dispose()
    host.remove()
  })
  const view = EditorView.findFromDOM(host.querySelector("[data-component=code-editor]") as HTMLElement)!
  return { host, dispose, view }
}

describe("buffer sync integration", () => {
  test("opens buffer on mount and debounces didChange with incremented version", async () => {
    const versions: number[] = []
    const opts = baseOpts({
      lsp: mockLsp({
        buffer: async (input) => {
          versions.push(input.version)
          return true
        },
      }),
    })
    const { view } = mountEditor(opts)
    await sleep(20)
    expect(versions.length).toBeGreaterThanOrEqual(1) // initial open
    const afterOpen = versions.length

    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } })
    await sleep(40)
    expect(versions.length).toBe(afterOpen + 1)
    expect(versions[versions.length - 1]).toBeGreaterThan(versions[0]!)
  })

  test("applies pushed diagnostics via subscribeDiagnostics", async () => {
    let emit: ((list: any) => void) | undefined
    const opts = baseOpts({
      subscribeDiagnostics: (_path, cb) => {
        emit = cb
        return () => {}
      },
    })
    const { view } = mountEditor(opts, "const x = 1")
    await sleep(20)
    emit!([
      { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, severity: 1, message: "bad" },
    ])
    await sleep(5)
    // setDiagnostics adds a lint state field; assert no throw and view alive.
    expect(view.state.doc.toString()).toBe("const x = 1")
  })

  test("teardown unsubscribes and closes buffer", async () => {
    let unsubscribed = false
    let closed = false
    const opts = baseOpts({
      subscribeDiagnostics: () => () => {
        unsubscribed = true
      },
      lsp: mockLsp({
        bufferClose: async () => {
          closed = true
          return true
        },
      }),
    })
    const { dispose } = mountEditor(opts)
    await sleep(20)
    dispose()
    cleanups.pop() // already disposed
    await sleep(5)
    expect(unsubscribed).toBe(true)
    expect(closed).toBe(true)
  })
})
