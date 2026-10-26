import { describe, expect, test } from "bun:test"
import { canReusePendingBlock } from "./markdown-projection"
import { project, stream } from "./markdown-stream"

describe("markdown stream", () => {
  test.each([
    "<div>\n\nWorld",
    "<details>\n\nWorld",
    "<!-- <div> -->\n\nWorld",
    "<pre>\n<div>\n</pre>\n\nWorld",
    '<div data-tip="a > <span>">\n</div>\n\nWorld',
  ])("preserves unfinished and quoted-attribute HTML groups on completion: %s", (tail) => {
    const text = `Hello\n\n${tail}`
    const live = project(undefined, text, true)
    const done = project(live, text, false)
    expect(done.blocks.map((block) => block.raw).join("")).toBe(text)
    expect(done.blocks.every((block) => block.mode === "full")).toBe(true)
  })

  test("ignores > and /> inside quoted HTML attributes when grouping blocks", () => {
    const closed = project(undefined, '<div data-tip="a > <span>">\n</div>\n\nSettled\n\nTail', true)
    expect(closed.blocks.map((block) => [block.raw, block.mode])).toEqual([
      ['<div data-tip="a > <span>">\n</div>\n\n', "full"],
      ["Settled\n\n", "full"],
      ["Tail", "live"],
    ])

    const grouped = project(undefined, '<div data-icon="/>">\n\n**Inside**\n\n</div>', false)
    expect(grouped.blocks).toEqual([
      {
        raw: '<div data-icon="/>">\n\n**Inside**\n\n</div>',
        src: '<div data-icon="/>">\n\n**Inside**\n\n</div>',
        mode: "full",
      },
    ])
  })

  test.each(["[x][r]\n\nOther\n\n[r]: /ok invalid", "[x][r]\n\nOther\n\n[r]: /ok\n| --- |\n"])(
    "retracts an invalidated provisional reference definition: %s",
    (text) => {
      let current = project(undefined, "", true)

      for (let i = 1; i <= text.length; i++) current = project(current, text.slice(0, i), true)
      expect(current.blocks[0]!.src).toBe("[x][r]\n\n")
      const done = project(current, text, false)
      expect(done.blocks[0]!.src).toBe("[x][r]\n\n")
    },
  )

  test("rebuilds long messages when an unsampled interior character changes", () => {
    const text = "Start\n\n" + "x".repeat(6000) + "\n\nTail"
    const live = project(undefined, text, true)
    const edited = text.slice(0, 1000) + "Y" + text.slice(1001)
    const next = project(live, edited, true)
    expect(next.blocks[0]).toBe(live.blocks[0])
    expect(next.blocks.map((block) => block.raw).join("")).toBe(edited)
    expect(project(next, edited, false).blocks.map((block) => block.raw).join("")).toBe(edited)
  })

  test("heals incomplete emphasis while streaming", () => {
    expect(stream("hello **world", true)).toEqual([{ raw: "hello **world", src: "hello **world**", mode: "live" }])
    expect(stream("say `code", true)).toEqual([{ raw: "say `code", src: "say `code`", mode: "live" }])
  })

  test.each([
    ["*foo*bar", "*foo*bar"],
    ["foo*bar", "foo*bar"],
    ["*foo*bar*baz", "*foo*bar*baz*"],
    ["\\(P(x_{t+1})\\)", "\\(P(x_{t+1})\\)"],
    ["\\(w^{*}\\) and *next", "\\(w^{*}\\) and *next*"],
  ])("preserves math and intraword emphasis in %s", (raw, src) => {
    expect(stream(raw, true)).toEqual([{ raw, src, mode: "live" }])
  })

  test("keeps a display math block with a blank line in one stable block", () => {
    expect(stream("$$\na\n\nb\n$$\n\nafter", true)).toEqual([
      { raw: "$$\na\n\nb\n$$\n\n", src: "$$\na\n\nb\n$$\n\n", mode: "full" },
      { raw: "after", src: "after", mode: "live" },
    ])
  })

  test("keeps incomplete links non-clickable until they finish", () => {
    expect(stream("see [docs](https://example.com/gu", true)).toEqual([
      { raw: "see [docs](https://example.com/gu", src: "see docs", mode: "live" },
    ])
  })

  test("splits an unfinished trailing code fence from stable content", () => {
    expect(stream("before\n\n```ts\nconst x = 1", true)).toEqual([
      { raw: "before\n\n", src: "before\n\n", mode: "full" },
      { raw: "```ts\nconst x = 1", src: "const x = 1", mode: "code", language: "ts" },
    ])
  })

  test("fully parses a code fence once it closes", () => {
    const text = "before\n\n```ts\nconst x = 1\n```"
    expect(stream(text, true)).toEqual([
      { raw: "before\n\n", src: "before\n\n", mode: "full" },
      { raw: "```ts\nconst x = 1\n```", src: "const x = 1", mode: "code", language: "ts", complete: true },
    ])
  })

  test("keeps a completed code fence in worker-rendered code mode when prose follows", () => {
    expect(stream("```ts\nconst x = 1\n```\n\nafter", true)).toEqual([
      { raw: "```ts\nconst x = 1\n```\n\n", src: "const x = 1", mode: "code", language: "ts", complete: true },
      { raw: "after", src: "after", mode: "live" },
    ])
  })

  test("freezes completed top-level blocks and only keeps the tail live", () => {
    expect(stream("# Plan\n\nFinished paragraph.\n\n- live item", true)).toEqual([
      { raw: "# Plan\n\n", src: "# Plan\n\n", mode: "full" },
      { raw: "Finished paragraph.\n\n", src: "Finished paragraph.\n\n", mode: "full" },
      { raw: "- live item", src: "- live item", mode: "live" },
    ])
  })

  test("keeps a growing table together until a later block freezes it", () => {
    expect(stream("| a | b |\n|---|---|\n| 1 | 2 |", true)).toEqual([
      { raw: "| a | b |\n|---|---|\n| 1 | 2 |", src: "| a | b |\n|---|---|\n| 1 | 2 |", mode: "live" },
    ])
  })

  test("reprojects non-prefix replacements from current content", () => {
    expect(stream("# Replacement\n\nNew body", true)).toEqual([
      { raw: "# Replacement\n\n", src: "# Replacement\n\n", mode: "full" },
      { raw: "New body", src: "New body", mode: "live" },
    ])
  })

  test("reprojects truncation without retaining removed blocks", () => {
    expect(stream("Only the restored prefix", true)).toEqual([
      { raw: "Only the restored prefix", src: "Only the restored prefix", mode: "live" },
    ])
  })

  test("shifts later blocks when an earlier block is inserted", () => {
    expect(stream("# Inserted\n\nFirst body\n\nSecond body", true)).toEqual([
      { raw: "# Inserted\n\n", src: "# Inserted\n\n", mode: "full" },
      { raw: "First body\n\n", src: "First body\n\n", mode: "full" },
      { raw: "Second body", src: "Second body", mode: "live" },
    ])
  })

  test("keeps reference-style markdown as one block", () => {
    expect(stream("[docs][1]\n\n[1]: https://example.com", true)).toEqual([
      {
        raw: "[docs][1]\n\n[1]: https://example.com",
        src: "[docs][1]\n\n[1]: https://example.com",
        mode: "live",
      },
    ])
  })

  test("keeps compact and indented reference definitions with their uses", () => {
    expect(stream("[docs]\n\n   [docs]:/guide", true)).toEqual([
      {
        raw: "[docs]\n\n   [docs]:/guide",
        src: "[docs]\n\n   [docs]:/guide",
        mode: "live",
      },
    ])
  })

  test("keeps multiline reference definitions with their uses", () => {
    expect(stream("[docs][id]\n\n[id]:\n  /guide", true)).toEqual([
      {
        raw: "[docs][id]\n\n[id]:\n  /guide",
        src: "[docs][id]\n\n[id]:\n  /guide",
        mode: "live",
      },
    ])
  })

  test("uses only the language portion of fence metadata", () => {
    expect(stream("```ts title=example\nconst x = 1", true)).toEqual([
      {
        raw: "```ts title=example\nconst x = 1",
        src: "const x = 1",
        mode: "code",
        language: "ts",
      },
    ])
  })

  test("preserves trailing newlines in open code fences", () => {
    expect(stream("```ts\nconst x = 1\n", true)).toEqual([
      {
        raw: "```ts\nconst x = 1\n",
        src: "const x = 1\n",
        mode: "code",
        language: "ts",
      },
    ])
  })

  test("only reuses pending blocks with compatible identity and content", () => {
    expect(
      canReusePendingBlock({ mode: "full", raw: "First\n\n" }, { mode: "full", raw: "# Inserted\n\n", src: "" }),
    ).toBe(false)
    expect(
      canReusePendingBlock({ mode: "code", raw: "```ts\none" }, { mode: "code", raw: "```ts\none two", src: "" }),
    ).toBe(true)
    expect(canReusePendingBlock({ mode: "live", raw: "partial" }, { mode: "live", raw: "partial text", src: "" })).toBe(
      true,
    )
    expect(canReusePendingBlock({ mode: "code", raw: "```ts\none" }, { mode: "live", raw: "one", src: "" })).toBe(false)
  })

  test("appends plain code deltas without reprojecting frozen blocks", () => {
    const previous = project(undefined, "# Plan\n\n```ts\nconst one = 1\n", true)
    const next = project(previous, `${previous.text}const two = 2\n`, true)

    expect(next.blocks[0]).toBe(previous.blocks[0])
    expect(next.blocks.at(-1)).toEqual({
      raw: "```ts\nconst one = 1\nconst two = 2\n",
      src: "const one = 1\nconst two = 2\n",
      mode: "code",
      language: "ts",
    })
  })

  test("finalizes only the live tail when streaming stops", () => {
    const live = project(undefined, "# Plan\n\nFinished paragraph.\n\n- final item", true)
    const final = project(live, live.text, false)

    expect(final.blocks[0]).toBe(live.blocks[0])
    expect(final.blocks[1]).toBe(live.blocks[1])
    expect(final.blocks[2]).toEqual({ raw: "- final item", src: "- final item", mode: "full" })
  })

  test("catches up paced text before finalizing", () => {
    const live = project(undefined, "# Plan\n\nFinished paragraph.\n\n- final", true)
    const final = project(live, `${live.text} item`, false)

    expect(canReusePendingBlock(live.blocks[0], final.blocks[0]!)).toBe(true)
    expect(canReusePendingBlock(live.blocks[1], final.blocks[1]!)).toBe(true)
    expect(final.blocks[2]).toEqual({ raw: "- final item", src: "- final item", mode: "full" })
  })

  test("completes an open code block when streaming stops", () => {
    const live = project(undefined, "```ts\nconst value = 1", true)
    const final = project(live, live.text, false)

    expect(final.blocks).toEqual([
      {
        raw: "```ts\nconst value = 1",
        src: "const value = 1",
        mode: "code",
        language: "ts",
        complete: true,
      },
    ])
  })

  test("does not add a blank line before the first streamed code", () => {
    const previous = project(undefined, "```ts\n", true)
    const next = project(previous, `${previous.text}const x = 1`, true)

    expect(next.blocks.at(-1)).toEqual({
      raw: "```ts\nconst x = 1",
      src: "const x = 1",
      mode: "code",
      language: "ts",
    })
  })

  test("closes code fences split across provider deltas", () => {
    const open = project(undefined, "```ts\nconst x = 1\n", true)
    const one = project(open, `${open.text}\``, true)
    const two = project(one, `${one.text}\``, true)
    const closed = project(two, `${two.text}\``, true)
    const prose = project(closed, `${closed.text}\nafter`, true)

    expect(closed.blocks.at(-1)).toEqual({
      raw: "```ts\nconst x = 1\n```",
      src: "const x = 1",
      mode: "code",
      language: "ts",
      complete: true,
    })
    expect(prose.blocks).toEqual([
      { raw: "```ts\nconst x = 1\n```\n", src: "const x = 1", mode: "code", language: "ts", complete: true },
      { raw: "after", src: "after", mode: "live" },
    ])
  })

  test("closes tilde fences split across provider deltas", () => {
    const open = project(undefined, "~~~ts\nconst x = 1\n", true)
    const one = project(open, `${open.text}~`, true)
    const two = project(one, `${one.text}~`, true)
    const closed = project(two, `${two.text}~`, true)

    expect(closed.blocks.at(-1)).toEqual({
      raw: "~~~ts\nconst x = 1\n~~~",
      src: "const x = 1",
      mode: "code",
      language: "ts",
      complete: true,
    })
  })

  test("keeps list-indented code fences inside the list so numbering and nested indentation match CommonMark", () => {
    const first = project(
      undefined,
      "1. First step\n   ```ts\n   const x = 1\n   ```\n2. Second step\n   ```ts\n   const y = 2",
      true,
    )

    expect(first.blocks).toEqual([
      {
        raw: "1. First step\n   ```ts\n   const x = 1\n   ```\n2. Second step\n   ```ts\n   const y = 2",
        src: "1. First step\n   ```ts\n   const x = 1\n   ```\n2. Second step\n   ```ts\n   const y = 2",
        mode: "live",
      },
    ])

    const next = project(first, `${first.text}\n   const z = 3`, true)
    expect(next.blocks).toEqual([
      {
        raw: "1. First step\n   ```ts\n   const x = 1\n   ```\n2. Second step\n   ```ts\n   const y = 2\n   const z = 3",
        src: "1. First step\n   ```ts\n   const x = 1\n   ```\n2. Second step\n   ```ts\n   const y = 2\n   const z = 3",
        mode: "live",
      },
    ])
  })

  test("back-patches only the block referencing a late reference definition and preserves definitions on finalize", () => {
    const first = project(
      undefined,
      "Read [docs][1].\n\nUnrelated settled paragraph.\n\nTrailing paragraph",
      true,
    )

    expect(first.blocks[0]).toEqual({ raw: "Read [docs][1].\n\n", src: "Read [docs][1].\n\n", mode: "full" })
    expect(first.blocks[1]).toEqual({
      raw: "Unrelated settled paragraph.\n\n",
      src: "Unrelated settled paragraph.\n\n",
      mode: "full",
    })

    const next = project(first, `${first.text}\n\n[1]: https://example.com/docs`, true)
    expect(next.blocks[1]).toBe(first.blocks[1])
    expect(next.blocks[0]).toEqual({
      raw: "Read [docs][1].\n\n",
      src: "Read [docs][1].\n\n\n\n[1]: https://example.com/docs",
      mode: "full",
    })

    const done = project(next, next.text, false)
    expect(done.blocks[0]).toEqual({
      raw: "Read [docs][1].\n\n",
      src: "Read [docs][1].\n\n\n\n[1]: https://example.com/docs",
      mode: "full",
    })
  })

  test("replaces the initial empty fallback block cleanly when streaming begins from empty text", () => {
    const doc = "# Heading\n\nFirst paragraph.\n\n```ts\nconst x = 1\n```\n\nTrailing paragraph."
    let prev = project(undefined, "", true)
    expect(prev.blocks).toEqual([{ raw: "", src: "", mode: "live" }])

    for (let i = 10; i <= doc.length; i += 10) {
      const slice = doc.slice(0, i)
      prev = project(prev, slice, true)
      expect(prev.blocks).toEqual(stream(slice, true))
    }

    const done = project(prev, doc, false)
    expect(done.blocks.every((block) => block.mode !== "live")).toBe(true)
    expect(done.blocks.map((block) => block.raw).join("")).toBe(doc)
  })
})
