import { describe, expect, test } from "bun:test"

describe("tui markdown link wrap wiring", () => {
  test("imports detectLinks from opentui core", async () => {
    const src = await Bun.file(new URL("../../../src/cli/cmd/tui/routes/session/index.tsx", import.meta.url)).text()
    const m = src.match(/import\s*{([^}]*)}\s*from\s*"@opentui\/core"/)
    expect(m).toBeTruthy()
    expect(m?.[1]).toContain("detectLinks")
  })

  test("uses detectLinks in non-experimental markdown code path", async () => {
    const src = await Bun.file(new URL("../../../src/cli/cmd/tui/routes/session/index.tsx", import.meta.url)).text()
    const start = src.indexOf("<Match when={!Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>")
    const end = src.indexOf("</Match>", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = src.slice(start, end)
    expect(block).toContain("<code")
    expect(block).toContain('filetype="markdown"')
    expect(block).toContain("onChunks={detectLinks}")
  })
})
