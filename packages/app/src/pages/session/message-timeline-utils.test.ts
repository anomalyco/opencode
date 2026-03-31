import { describe, expect, test } from "bun:test"
import {
  captureScroll,
  itemStyle,
  pickPin,
  restorePinnedTop,
  restoreScroll,
  virtualizeTop,
  virtualize,
} from "./message-timeline-utils"

describe("message timeline helpers", () => {
  test("keeps virtualization off while a turn is still working", () => {
    expect(
      virtualize({
        desktop: true,
        count: 12,
        working: true,
      }),
    ).toBe(false)
  })

  test("virtualizes large idle desktop timelines", () => {
    expect(
      virtualize({
        desktop: true,
        count: 12,
        working: false,
      }),
    ).toBe(true)
  })

  test("captures bottom gap for later restoration", () => {
    expect(
      captureScroll({
        scrollTop: 780,
        scrollHeight: 1000,
        clientHeight: 200,
      }),
    ).toEqual({
      top: 780,
      gap: 20,
      bottom: false,
    })
  })

  test("restores bottom distance after content height changes", () => {
    expect(
      restoreScroll({
        top: 780,
        gap: 0,
        bottom: true,
        scrollHeight: 1600,
        clientHeight: 200,
      }),
    ).toBe(1400)
  })

  test("restores prior top when not anchored to bottom", () => {
    expect(
      restoreScroll({
        top: 320,
        gap: 480,
        bottom: false,
        scrollHeight: 1600,
        clientHeight: 200,
      }),
    ).toBe(320)
  })

  test("pins the visible message nearest the reading line", () => {
    expect(
      pickPin({
        viewTop: 200,
        viewBottom: 700,
        items: [
          { id: "a", top: 120, bottom: 180 },
          { id: "b", top: 240, bottom: 360 },
          { id: "c", top: 420, bottom: 560 },
        ],
      }),
    ).toEqual({ id: "b", top: 40 })
  })

  test("restores scroll from a pinned message after layout changes", () => {
    expect(
      restorePinnedTop({
        scrollTop: 780,
        scrollHeight: 1800,
        clientHeight: 200,
        pinTop: 40,
        nextTop: 120,
      }),
    ).toBe(860)
  })

  test("keeps the timeline pinned to the bottom while virtualization flips in follow mode", () => {
    expect(
      virtualizeTop({
        follow: true,
        top: 0,
        gap: 0,
        bottom: true,
        scrollHeight: 7063,
        clientHeight: 834,
      }),
    ).toBe(6229)
  })

  test("preserves the previous reading position when virtualization flips away from follow mode", () => {
    expect(
      virtualizeTop({
        follow: false,
        top: 320,
        gap: 480,
        bottom: false,
        scrollHeight: 1600,
        clientHeight: 200,
      }),
    ).toBe(320)
  })

  test("keeps centered item layout without intrinsic size shortcuts", () => {
    const style = itemStyle(true)

    expect(style["max-width"]).toBe("var(--session-content-width, 60rem)")
    expect(style["margin-left"]).toBe("auto")
    expect(style["margin-right"]).toBe("auto")
    expect(style["content-visibility"]).toBeUndefined()
    expect(style["contain-intrinsic-size"]).toBeUndefined()
  })
})
