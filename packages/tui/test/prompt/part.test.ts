import { describe, expect, test } from "bun:test"
import { expandPastedTextPlaceholders, expandTrackedPastedText, stripPromptPartIDs } from "../../src/prompt/part"

function pastedTextPart(marker: string, text: string) {
  return { type: "text" as const, text, source: { text: { value: marker } } }
}

describe("prompt part", () => {
  test("strips persisted IDs from reused parts", () => {
    expect(
      stripPromptPartIDs({
        id: "prt_old",
        sessionID: "ses_old",
        messageID: "msg_old",
        type: "file" as const,
        mime: "image/png",
        filename: "tiny.png",
        url: "data:image/png;base64,abc",
      }),
    ).toEqual({
      type: "file",
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    })
  })

  test("preserves wide characters around pasted text", () => {
    const marker = "[Pasted ~3 lines]"
    const prefix = "你好你好\n"

    expect(
      expandTrackedPastedText(prefix + marker + "\n阿斯顿法国红酒看来", [
        {
          start: Bun.stringWidth("你好你好") + 1,
          end: Bun.stringWidth("你好你好") + 1 + Bun.stringWidth(marker),
          text: "public:\n\tvoid ExecuteTask();\nprivate:",
        },
      ]),
    ).toBe("你好你好\npublic:\n\tvoid ExecuteTask();\nprivate:\n阿斯顿法国红酒看来")
  })

  test("only expands the tracked placeholder occurrence", () => {
    const marker = "[Pasted ~3 lines]"
    const prefix = `keep ${marker} then `

    expect(
      expandTrackedPastedText(prefix + marker + " tail", [
        {
          start: Bun.stringWidth(prefix),
          end: Bun.stringWidth(prefix + marker),
          text: "alpha\nbeta\ngamma",
        },
      ]),
    ).toBe(`keep ${marker} then alpha\nbeta\ngamma tail`)
  })

  test("expands placeholders with dollar sequences literally", () => {
    const marker = "[Pasted ~1 lines]"
    for (const pasted of ["const cost = ${price}$$", "echo $&foo", "a $` b", "x $' y", "price $1 each"]) {
      expect(expandPastedTextPlaceholders(`see ${marker} here`, [pastedTextPart(marker, pasted)])).toBe(
        `see ${pasted} here`,
      )
    }
  })

  test("expands repeated same-line-count placeholders in order", () => {
    const marker = "[Pasted ~2 lines]"
    expect(
      expandPastedTextPlaceholders(`${marker} and ${marker}`, [
        pastedTextPart(marker, "first"),
        pastedTextPart(marker, "second"),
      ]),
    ).toBe("first and second")
  })

  test("leaves non pasted-text parts untouched", () => {
    const marker = "[Pasted ~1 lines]"
    expect(
      expandPastedTextPlaceholders(`see ${marker} here`, [
        { type: "file", url: "data:," },
        pastedTextPart(marker, "$$$"),
      ]),
    ).toBe("see $$$ here")
  })
})
