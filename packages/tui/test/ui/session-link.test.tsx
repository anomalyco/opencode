/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { SyntaxStyle, TextAttributes } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { clickedSession, linkSessions } from "../../src/ui/session-link"

const id = "ses_0123456789abcdefghijABCDEF"
const other = "ses_ZYXWVUTSRQponmlkjih9876543"
const partial = "ses_0123456789abcdef"

test.each(["top-level", "coalesced"] as const)(
  "session IDs in %s markdown prose are styled and open on a plain click",
  async (mode) => {
    const opened: string[] = []
    function Transcript() {
      const renderer = useRenderer()
      const syntaxStyle = SyntaxStyle.fromStyles(
        { default: { fg: "#ffffff" }, "markup.link.url": { fg: "#00ff00" } },
        renderer.nativeScene,
      )
      onCleanup(() => syntaxStyle.destroy())
      return (
        <box
          onMouseUp={(event) => {
            const sessionID = clickedSession(renderer, event)
            if (sessionID) opened.push(sessionID)
          }}
        >
          <markdown
            ref={linkSessions}
            internalBlockMode={mode}
            syntaxStyle={syntaxStyle}
            content={[
              `**中文** see \`it\` in ${id} now`,
              "",
              `- nested ${other}`,
              "",
              "```",
              `code ${id}`,
              "```",
              "",
              `partial ${partial}`,
            ].join("\n")}
          />
        </box>
      )
    }
    const app = await testRender(() => <Transcript />, { width: 36, height: 14, clock: new ManualClock() })

    try {
      // Highlighting runs on the tree-sitter worker; the first frame is unstyled.
      const linked = () =>
        app
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .filter((span) => span.attributes & TextAttributes.UNDERLINE)
          .map((span) => span.text.trim())
      for (let attempt = 0; attempt < 100 && !linked().includes(other); attempt++) {
        await app.renderOnce()
        await Bun.sleep(10)
      }
      const rows = app.captureCharFrame().split("\n")
      const row = (text: string) => rows.findIndex((line) => line.includes(text))
      // Wraps onto its own row after the wide characters and concealed markers.
      expect(rows[row(id)]!.trim()).toBe(`${id} now`)
      expect(linked()).toEqual([id, other])

      await app.mockMouse.click(rows[row(id)]!.indexOf(id) + 5, row(id))
      await app.mockMouse.click(rows[row(other)]!.indexOf(other) + 20, row(other))
      expect(opened).toEqual([id, other])

      app.renderer.clearSelection()
      await app.mockMouse.click(rows[row("code")]!.indexOf("ses_") + 2, row("code"))
      await app.mockMouse.click(rows[row("partial")]!.indexOf("ses_") + 2, row("partial"))
      await app.mockMouse.click(rows[row("nested")]!.indexOf("nested"), row("nested"))
      await app.mockMouse.drag(rows[row(id)]!.indexOf(id), row(id), rows[row(id)]!.indexOf(id) + 4, row(id))
      expect(opened).toEqual([id, other])
    } finally {
      app.renderer.destroy()
    }
  },
)
