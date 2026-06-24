import { test, expect } from "bun:test"
import { Flex } from "@/terminal/layout/Flex"
import type { LayoutNode } from "@/terminal/layout/Types"

const flex = new Flex()

test("solve single child fills container", () => {
  const root = makeNode(0, 0, 20, 10)
  const child = makeNode(0, 0, 1, 1, { grow: 1 })
  root.children = [child]

  flex.solve(root, 20, 10)

  expect(child.x).toBe(0)
  expect(child.y).toBe(0)
  expect(child.width).toBe(20)
  expect(child.height).toBe(10)
})

test("two children with equal grow split space", () => {
  const root = makeNode(0, 0, 20, 10, { direction: "row" })
  const a = makeNode(0, 0, 1, 1, { grow: 1 })
  const b = makeNode(0, 0, 1, 1, { grow: 1 })
  root.children = [a, b]

  flex.solve(root, 20, 10)

  expect(a.x).toBe(0)
  expect(a.width).toBe(10)
  expect(b.x).toBe(10)
  expect(b.width).toBe(10)
})

test("children with grow 2 and 1 split 2:1", () => {
  const root = makeNode(0, 0, 30, 10, { direction: "row" })
  const a = makeNode(0, 0, 1, 1, { grow: 2 })
  const b = makeNode(0, 0, 1, 1, { grow: 1 })
  root.children = [a, b]

  flex.solve(root, 30, 10)

  expect(a.width).toBe(20)
  expect(b.width).toBe(10)
})

test("column direction stacks children vertically", () => {
  const root = makeNode(0, 0, 20, 20)
  const a = makeNode(0, 0, 1, 1, { grow: 1 })
  const b = makeNode(0, 0, 1, 1, { grow: 1 })
  root.children = [a, b]

  flex.solve(root, 20, 20)

  expect(a.y).toBe(0)
  expect(a.height).toBe(10)
  expect(b.y).toBe(10)
  expect(b.height).toBe(10)
})

test("padding shrinks inner area", () => {
  const root = makeNode(0, 0, 20, 10, { padding: [1, 1, 1, 1] })
  const child = makeNode(0, 0, 1, 1, { grow: 1 })
  root.children = [child]

  flex.solve(root, 20, 10)

  expect(child.x).toBe(0 + 1)
  expect(child.y).toBe(0 + 1)
  expect(child.width).toBe(20 - 2)
  expect(child.height).toBe(10 - 2)
})

test("borderWidth shrinks inner area", () => {
  const root = makeNode(0, 0, 20, 10, { borderWidth: 2 })
  const child = makeNode(0, 0, 1, 1, { grow: 1 })
  root.children = [child]

  flex.solve(root, 20, 10)

  expect(child.x).toBe(2)
  expect(child.y).toBe(2)
  expect(child.width).toBe(20 - 4)
  expect(child.height).toBe(10 - 4)
})

test("margin creates gap between children", () => {
  const root = makeNode(0, 0, 22, 10, { direction: "row" })
  const a = makeNode(0, 0, 1, 1, { grow: 1, margin: [0, 1, 0, 0] })
  const b = makeNode(0, 0, 1, 1, { grow: 1, margin: [0, 0, 0, 1] })
  root.children = [a, b]

  flex.solve(root, 22, 10)

  expect(a.width).toBe(10)
  expect(b.x).toBeGreaterThan(a.x + a.width)
})

test("zero children produces no error", () => {
  const root = makeNode(0, 0, 10, 10)
  flex.solve(root, 10, 10)
  expect(root.width).toBe(10)
})

test("negative space handles shrink factor", () => {
  const root = makeNode(0, 0, 10, 10, { direction: "row" })
  const a = makeNode(0, 0, 10, 1, { shrink: 1 })
  const b = makeNode(0, 0, 10, 1, { shrink: 1 })
  root.children = [a, b]

  flex.solve(root, 10, 10)

  expect(a.width + b.width).toBeLessThanOrEqual(10)
  expect(a.width).toBeGreaterThan(0)
  expect(b.width).toBeGreaterThan(0)
})

type MakeNodeProps = Partial<Pick<LayoutNode, "direction" | "grow" | "shrink" | "basis" | "padding" | "margin" | "borderWidth">>

function makeNode(
  x: number, y: number, w: number, h: number,
  props: MakeNodeProps = {},
): LayoutNode {
  return {
    direction: props.direction ?? "column",
    grow: props.grow ?? 0,
    shrink: props.shrink ?? 0,
    basis: props.basis ?? 0,
    padding: props.padding ?? [0, 0, 0, 0],
    margin: props.margin ?? [0, 0, 0, 0],
    borderWidth: props.borderWidth ?? 0,
    x, y, width: w, height: h,
    children: [],
  }
}
