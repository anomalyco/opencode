import { expect, test } from "bun:test"
import type { Renderable } from "@opentui/core"
import { disableSelectionSubtree } from "../../src/routes/session/sidebar"

type MockRenderable = {
  selectable: boolean
  children: MockRenderable[]
  getChildren: () => MockRenderable[]
}

function mockRenderable(children: MockRenderable[] = []): MockRenderable {
  return {
    selectable: true,
    children,
    getChildren() {
      return this.children
    },
  }
}

function asRenderable(node: MockRenderable) {
  return node as unknown as Renderable
}

test("disableSelectionSubtree disables selection for all descendants", () => {
  const leaf = mockRenderable()
  const nested = mockRenderable([leaf])
  const sibling = mockRenderable()
  const root = mockRenderable([nested, sibling])

  disableSelectionSubtree(asRenderable(root))

  expect(root.selectable).toBe(false)
  expect(nested.selectable).toBe(false)
  expect(leaf.selectable).toBe(false)
  expect(sibling.selectable).toBe(false)
})
