import { describe, expect, test } from "bun:test"
import { getAnnotationBubblePosition } from "./AnnotationBubble"

describe("getAnnotationBubblePosition", () => {
  test("keeps the bubble inside the viewport", () => {
    expect(
      getAnnotationBubblePosition(
        { x: 260, y: 190, width: 40, height: 20 },
        { width: 320, height: 240 },
      ),
    ).toEqual({ left: 28, top: 80 })
  })

  test("exposes an explicit accessible name for the comment textarea", () => {
    expect(Bun.file(new URL("./AnnotationBubble.tsx", import.meta.url)).text()).resolves.toContain(
      'aria-label="Annotation comment"',
    )
  })
})
