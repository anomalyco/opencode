import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import type { SelectedLineRange } from "@pierre/diffs"
import { createRoot } from "solid-js"
import type { HoverCommentLine } from "../pierre/comment-hover"
import { createLineCommentGutterRenderer } from "./line-comment-annotations"

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

/** What a Pierre instance reports as hovered, and how often the button asked. */
type Viewer = { hovered: HoverCommentLine | undefined; reads: number }

function setup() {
  const opened: SelectedLineRange[] = []
  const viewer: Viewer = { hovered: undefined, reads: 0 }

  const getHoveredLine = () => {
    viewer.reads++

    return viewer.hovered
  }

  return createRoot((dispose) => ({
    opened,
    viewer,
    getHoveredLine,
    dispose,
    render: createLineCommentGutterRenderer({
      label: "Comment",
      getSelectedRange: () => null,
      onOpenDraft: (range) => opened.push(range),
    }),
  }))
}

test("tracks the hovered line when the pointer moves before Pierre inserts the button", () => {
  const gutter = setup()
  const button = gutter.render(gutter.getHoveredLine)!
  document.dispatchEvent(new Event("pointermove"))
  document.dispatchEvent(new Event("scroll"))
  document.body.replaceChildren(button)

  gutter.viewer.hovered = { lineNumber: 5, side: "additions" }
  document.dispatchEvent(new Event("pointermove"))
  gutter.viewer.hovered = undefined
  button.click()

  expect(gutter.opened).toEqual([{ start: 5, end: 5, side: "additions" }])
  gutter.dispose()
})

test("reuses one button across Pierre rerenders and detaches it on cleanup", () => {
  const gutter = setup()
  const button = gutter.render(gutter.getHoveredLine)!
  document.body.replaceChildren(button)

  expect(gutter.render(gutter.getHoveredLine)).toBe(button)

  // A reset viewer is a new Pierre instance with its own `getHoveredLine`.
  const next = { reads: 0 }

  const replaced = gutter.render(() => {
    next.reads++

    return undefined
  })!

  expect(replaced).not.toBe(button)
  const reads = gutter.viewer.reads
  document.dispatchEvent(new Event("pointermove"))
  expect(gutter.viewer.reads).toBe(reads)

  document.body.replaceChildren(replaced)
  document.dispatchEvent(new Event("pointermove"))
  expect(next.reads).toBe(1)
  gutter.dispose()
  document.dispatchEvent(new Event("pointermove"))
  expect(next.reads).toBe(1)
})
