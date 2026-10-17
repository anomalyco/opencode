import { describe, expect, test } from "bun:test"
import { canReusePendingBlock, completedProjection } from "./markdown-projection"
import { project, stream } from "./markdown-stream"

describe("markdown stream", () => {
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

  test("appends plain text deltas without reprojecting frozen blocks", () => {
    const previous = project(undefined, "# Plan\n\nFinished paragraph.\n\n- final", true)
    const next = project(previous, `${previous.text} item`, true)

    expect(next.blocks[0]).toBe(previous.blocks[0])
    expect(next.blocks[1]).toBe(previous.blocks[1])
    expect(next.blocks.at(-1)).toEqual({ raw: "- final item", src: "- final item", mode: "live" })
  })

  test("grows ordinary prose in place without re-lexing earlier blocks", () => {
    let grown = project(undefined, "# Title\n\nA paragraph", true)
    const heading = grown.blocks[0]

    for (let index = 0; index < 200; index++) grown = project(grown, `${grown.text} word`, true)

    expect(grown.blocks[0]).toBe(heading)
    expect(grown.blocks).toHaveLength(2)
    expect(grown.blocks.at(-1)).toEqual({
      raw: `A paragraph${" word".repeat(200)}`,
      src: `A paragraph${" word".repeat(200)}`,
      mode: "live",
    })
  })

  test("boundedly re-lexes the live tail once it exceeds the cap", () => {
    const unit = "para\n\n"
    let grown = project(undefined, unit, true)

    for (let index = 0; index < 400; index++) grown = project(grown, `${grown.text}${unit}`, true)

    expect(grown.blocks.at(-1)!.mode).toBe("live")
    expect(grown.blocks.filter((block) => block.mode === "full").length).toBeGreaterThan(0)
    expect(grown.blocks.map((block) => block.raw).join("")).toBe(grown.text)
  })

  test("grows a boundary-less oversized tail in place without splitting", () => {
    const word = "word "
    let grown = project(undefined, word, true)

    for (let index = 0; index < 600; index++) grown = project(grown, `${grown.text}${word}`, true)

    expect(grown.blocks).toHaveLength(1)
    expect(grown.blocks[0]!.mode).toBe("live")
    expect(grown.blocks[0]!.raw).toBe(word.repeat(601))
  })

  test("re-projects the live tail when an oversized tail crosses a blank-line boundary", () => {
    const body = "sentence ".repeat(300)
    let grown = project(undefined, body, true)
    expect(grown.blocks).toHaveLength(1)

    grown = project(grown, `${grown.text}\n\nnext paragraph`, true)

    expect(grown.blocks.length).toBeGreaterThan(1)
    expect(grown.blocks.at(-1)).toEqual({ raw: "next paragraph", src: "next paragraph", mode: "live" })
    expect(grown.blocks.map((block) => block.raw).join("")).toBe(grown.text)
  })

  test("splits an oversized live tail when blank-line separators are split across deltas", () => {
    const paragraph = (index: number) => `Paragraph ${index} ${"filler ".repeat(30).trim()}`
    let text = ""
    let previous: ReturnType<typeof project> | undefined

    for (let index = 0; index < 60; index++) {
      text += paragraph(index)
      previous = project(previous, text, true)

      text += "\n"
      previous = project(previous, text, true)

      text += "\n"
      previous = project(previous, text, true)

      expect(previous.blocks.map((block) => block.raw).join("")).toBe(text)
    }

    // Each paragraph is a completed block even though every blank-line separator
    // arrived as two deltas, so the tail never grows into one oversized block.
    const completed = previous!
    expect(completed.blocks).toHaveLength(60)
    expect(completed.blocks.at(-1)!.mode).toBe("live")

    const frozen = completed.blocks.slice(0, -1)

    text += "# Heading"
    const heading = project(completed, text, true)

    // The heading starts its own block instead of joining the previous tail.
    expect(heading.blocks.at(-1)).toEqual({ raw: "# Heading", src: "# Heading", mode: "live" })
    expect(heading.blocks.map((block) => block.raw).join("")).toBe(text)

    // Blocks that did not need to change keep their identity.
    for (let index = 0; index < frozen.length; index++) expect(heading.blocks[index]).toBe(frozen[index])

    // The incremental projection matches a fresh projection of the same source.
    expect(heading.blocks).toEqual(stream(text, true))
  })

  test("keeps a list in one live block while items are appended", () => {
    let previous = project(undefined, "- one\n- two", true)
    previous = project(previous, `${previous.text}\n- three`, true)

    expect(previous.blocks).toEqual([{ raw: "- one\n- two\n- three", src: "- one\n- two\n- three", mode: "live" }])
  })

  test("keeps a table in one live block while rows are appended", () => {
    let previous = project(undefined, "| a | b |\n|---|---|\n| 1 | 2 |", true)
    previous = project(previous, `${previous.text}\n| 3 | 4 |`, true)

    expect(previous.blocks).toEqual([
      {
        raw: "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |",
        src: "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |",
        mode: "live",
      },
    ])
  })

  test("heals an incomplete link across appended deltas", () => {
    let previous = project(undefined, "see [docs](https://example.com/gu", true)
    previous = project(previous, `${previous.text}ide`, true)

    expect(previous.blocks).toEqual([{ raw: "see [docs](https://example.com/guide", src: "see docs", mode: "live" }])
  })

  test("keeps a display math block in one live block while it grows", () => {
    let previous = project(undefined, "$$\na", true)
    previous = project(previous, `${previous.text}\n\nb\n$$`, true)
    previous = project(previous, `${previous.text}\n\nafter`, true)

    expect(previous.blocks).toEqual([{ raw: "$$\na\n\nb\n$$\n\nafter", src: "$$\na\n\nb\n$$\n\nafter", mode: "live" }])
  })

  test("switches a growing tail to code mode when a fence opens", () => {
    const previous = project(undefined, "Here is some code:", true)
    const next = project(previous, `${previous.text}\n\n\`\`\`ts\nconst x = 1`, true)

    expect(next.blocks).toEqual([
      { raw: "Here is some code:\n\n", src: "Here is some code:\n\n", mode: "full" },
      { raw: "```ts\nconst x = 1", src: "const x = 1", mode: "code", language: "ts" },
    ])
  })

  test("switches a growing tail to code mode when a fence is split across deltas", () => {
    const previous = project(undefined, "Here is some code:", true)
    const opened = project(previous, `${previous.text}\n\n\`\`\``, true)
    const typed = project(opened, `${opened.text}ts\nconst x = 1`, true)

    expect(typed.blocks).toEqual([
      { raw: "Here is some code:\n\n", src: "Here is some code:\n\n", mode: "full" },
      { raw: "```ts\nconst x = 1", src: "const x = 1", mode: "code", language: "ts" },
    ])
  })

  test("completes a fence opened while the tail was live", () => {
    const previous = project(undefined, "Here is some code:", true)
    const opened = project(previous, `${previous.text}\n\n\`\`\`ts\nconst x = 1`, true)
    const closed = project(opened, `${opened.text}\n\`\`\``, true)

    expect(closed.blocks.at(-1)).toEqual({
      raw: "```ts\nconst x = 1\n```",
      src: "const x = 1",
      mode: "code",
      language: "ts",
      complete: true,
    })
  })

  test("falls back to a full re-lex when a late reference definition arrives", () => {
    const previous = project(undefined, "See [docs][1].\n\nA body paragraph.", true)
    expect(previous.blocks).toHaveLength(2)

    const next = project(previous, `${previous.text}\n\n[1]: https://example.com`, true)

    expect(next.blocks).toEqual([
      {
        raw: "See [docs][1].\n\nA body paragraph.\n\n[1]: https://example.com",
        src: "See [docs][1].\n\nA body paragraph.\n\n[1]: https://example.com",
        mode: "live",
      },
    ])
  })

  test("catches up a reference definition split across appended deltas", () => {
    const previous = project(undefined, "See [docs][1].\n\nA body paragraph.", true)
    const partial = project(previous, `${previous.text}\n\n[1]:`, true)
    const complete = project(partial, `${partial.text} https://example.com`, true)

    expect(complete.blocks).toEqual([
      {
        raw: "See [docs][1].\n\nA body paragraph.\n\n[1]: https://example.com",
        src: "See [docs][1].\n\nA body paragraph.\n\n[1]: https://example.com",
        mode: "live",
      },
    ])
  })

  test("does not reuse stale projection state for non-append updates", () => {
    const previous = project(undefined, "# Old\n\nOld body", true)
    const next = project(previous, "# New\n\nNew body", true)

    expect(next.blocks).toEqual(stream("# New\n\nNew body", true))
  })

  test("reprojects truncation through project without retaining removed blocks", () => {
    const previous = project(undefined, "First paragraph.\n\nSecond paragraph.", true)
    const next = project(previous, "First paragraph.", true)

    expect(next.blocks).toEqual(stream("First paragraph.", true))
  })

  test("returns the previous projection when the text is unchanged", () => {
    const previous = project(undefined, "# Plan\n\n- item", true)

    expect(project(previous, previous.text, true)).toBe(previous)
  })

  test("final incremental projection matches a full projection", () => {
    let previous = project(undefined, "The quick", true)

    for (const delta of [" brown", " fox", " jumps", " over", " the", " lazy", " dog"]) {
      previous = project(previous, `${previous.text}${delta}`, true)
    }

    const final = project(previous, previous.text, false)

    expect(final.blocks).toEqual(completedProjection(previous.text).blocks)
  })

  test("keeps the incremental projection a faithful partition of the text", () => {
    const deltas = [
      "# Head\n",
      "\n",
      "First ",
      "paragraph.\n",
      "\n",
      "- item one\n",
      "- item two\n",
      "\n",
      "```",
      "js\n",
      "const x = 1",
    ]

    let text = ""
    let previous: ReturnType<typeof project> | undefined

    for (const delta of deltas) {
      text += delta
      previous = project(previous, text, true)

      expect(previous.blocks.map((block) => block.raw).join("")).toBe(text)
    }
  })

  test("keeps a bare list marker verbatim instead of marked's normalized form", () => {
    // `raw` must reconstruct the source; `src` is still healed (trailing space trimmed).
    expect(stream("1. ", true)).toEqual([{ raw: "1. ", src: "1.", mode: "live" }])
    expect(stream("- ", true)).toEqual([{ raw: "- ", src: "-", mode: "live" }])
  })

  test("does not accumulate a normalized list marker across appended deltas", () => {
    let grown = project(undefined, "1. ", true)
    grown = project(grown, `${grown.text}first`, true)
    grown = project(grown, `${grown.text}\n2. second`, true)

    expect(grown.blocks.map((block) => block.raw).join("")).toBe(grown.text)
    expect(grown.blocks).toEqual([{ raw: "1. first\n2. second", src: "1. first\n2. second", mode: "live" }])
  })

  test("repairs a display math block that was frozen while it was still open", () => {
    const text = "$$\na + b\n\nc + d\n$$\n\nafter math"
    const opened = project(undefined, "$$\na + b\n\nc +", true)

    // The first slice cannot see the closing `$$`, so it freezes the opening
    // paragraphs. The next delta must re-lex instead of growing that split.
    expect(stream(opened.text, true).some((block) => block.mode === "full")).toBe(true)

    const closed = project(opened, text, true)

    expect(closed.blocks).toEqual(stream(text, true))
  })

  test("repairs a split display math block across many small deltas", () => {
    const text = "$$\na + b\n\nc + d\n$$\n\nafter math"
    let previous: ReturnType<typeof project> | undefined
    let current = ""

    for (const delta of ["$$\na + b\n\nc", " + d\n$$\n", "\nafter ", "math"]) {
      current += delta
      previous = project(previous, current, true)

      expect(previous.blocks.map((block) => block.raw).join("")).toBe(current)
    }

    // The math stays in one live block and is never cut by a leftover delimiter.
    expect(previous!.blocks).toHaveLength(1)
    expect(previous!.blocks[0]!.raw).toBe(text)
    expect(previous!.blocks[0]!.src).toBe(text)
  })

  test("does not heal completed content before the active tail", () => {
    let previous = project(undefined, "Escaped \\[ bracket", true)
    previous = project(previous, `${previous.text}\n\nMore`, true)

    // `heal` misreads the leading `\[` as an incomplete link and strips the
    // bracket; only the active tail may be healed.
    expect(previous.blocks).toEqual([
      { raw: "Escaped \\[ bracket\n\nMore", src: "Escaped \\[ bracket\n\nMore", mode: "live" },
    ])
  })
})
