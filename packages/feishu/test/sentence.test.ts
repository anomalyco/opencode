import { describe, expect, test } from "bun:test"
import { splitMessage } from "../src/sentence"

describe("message sentence segmentation", () => {
  test("preserves Chinese and English punctuation in exact order", async () => {
    const segments = await splitMessage("msg_1", "库存200。货架B-11-13！Ready? Yes;")

    expect(segments.map((segment) => segment.text)).toEqual(["库存200。", "货架B-11-13！", "Ready?", " Yes;"])
    expect(segments.map((segment) => segment.index)).toEqual([0, 1, 2, 3])
    expect(segments.map((segment) => segment.text).join("")).toBe("库存200。货架B-11-13！Ready? Yes;")
  })

  test("preserves LF and CRLF boundaries without rewriting", async () => {
    const text = "第一行\n第二行。\r\nThird"
    const segments = await splitMessage("msg_2", text)

    expect(segments.map((segment) => segment.text)).toEqual(["第一行\n", "第二行。\r\n", "Third"])
    expect(segments.map((segment) => segment.text).join("")).toBe(text)
  })

  test("uses the whole message at index zero without a reliable boundary", async () => {
    expect(await splitMessage("msg_3", "6001ZZ 清油 12×28×8")).toEqual([
      {
        id: "sentence_780f78352d849a1d85800f7849b74a3a1c10685b3c17f80f",
        index: 0,
        text: "6001ZZ 清油 12×28×8",
      },
    ])
  })

  test("derives stable distinct sentence IDs from message identity and position", async () => {
    const first = await splitMessage("msg_4", "一样。一样。")
    const repeated = await splitMessage("msg_4", "一样。一样。")
    const otherMessage = await splitMessage("msg_5", "一样。一样。")

    expect(first).toEqual(repeated)
    expect(first[0]?.id).not.toBe(first[1]?.id)
    expect(first[0]?.id).not.toBe(otherMessage[0]?.id)
  })
})
