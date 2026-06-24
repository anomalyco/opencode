import type { LayoutNode } from "./Types"

export class Flex {
  solve(
    node: LayoutNode,
    availableWidth: number,
    availableHeight: number,
  ): void {
    const pad = node.padding ?? [0, 0, 0, 0]
    const bw = node.borderWidth ?? 0
    const bw2 = bw * 2
    const innerX = node.x + bw + pad[3]
    const innerY = node.y + bw + pad[0]
    const innerW = Math.max(0, availableWidth - bw2 - pad[1] - pad[3])
    const innerH = Math.max(0, availableHeight - bw2 - pad[0] - pad[2])

    assign(node, node.x, node.y, availableWidth, availableHeight)

    if (node.children.length === 0) return

    const dir = node.direction ?? "column"
    const mainMarginSum = childMargins(node, dir)
    let totalBasis = 0

    for (const child of node.children) {
      const b = child.basis ?? 0
      const cm = childMargins(child, dir)
      totalBasis += b + cm
    }

    const mainSize = dir === "row" ? innerW : innerH
    const remaining = mainSize - totalBasis
    let totalGrow = 0
    let totalShrink = 0
    for (const child of node.children) {
      if (remaining > 0) totalGrow += child.grow ?? 0
      else if (remaining < 0) totalShrink += child.shrink ?? 0
    }

    const sizes: number[] = []
    for (const child of node.children) {
      const b = child.basis ?? 0
      const cm = childMargins(child, dir)
      let cs = b

      if (remaining > 0 && totalGrow > 0) {
        cs += Math.floor((remaining * (child.grow ?? 0)) / totalGrow)
      } else if (remaining < 0 && totalShrink > 0) {
        cs += Math.ceil((remaining * (child.shrink ?? 0)) / totalShrink)
      }

      cs = Math.max(0, cs)
      sizes.push(cs + cm)
    }

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      const totalSize = sizes[i]
      const m = child.margin ?? [0, 0, 0, 0]
      const cm = childMargins(child, dir)
      const contentSize = Math.max(1, totalSize - cm)
      const cr = childMargins(child, dir === "row" ? "column" : "row")
      const crossSize = dir === "row"
        ? Math.max(1, innerH - cr)
        : Math.max(1, innerW - cr)

      if (dir === "row") {
        child.width = contentSize
        child.height = crossSize
      } else {
        child.height = contentSize
        child.width = crossSize
      }

      if (child.children.length > 0) {
        this.passMeasure(child)
      }
    }

    passDistribute(node, innerX, innerY, innerW, innerH, dir)
  }

  private passMeasure(node: LayoutNode): void {
    const dir = node.direction ?? "column"
    const bw = node.borderWidth ?? 0
    const pad = node.padding ?? [0, 0, 0, 0]

    for (const child of node.children) {
      if (child.children.length > 0) {
        this.passMeasure(child)
      }
    }
  }
}

function assign(node: LayoutNode, x: number, y: number, w: number, h: number): void {
  node.x = x; node.y = y; node.width = w; node.height = h
}

function childMargins(node: LayoutNode, dir: "row" | "column"): number {
  const m = node.margin ?? [0, 0, 0, 0]
  return dir === "row" ? m[1] + m[3] : m[0] + m[2]
}

function passDistribute(
  node: LayoutNode,
  offsetX: number,
  offsetY: number,
  availableW: number,
  availableH: number,
  dir: "row" | "column",
): void {
  let cursorMain = 0
  const originMain = dir === "row" ? offsetX : offsetY
  const originCross = dir === "row" ? offsetY : offsetX

  for (const child of node.children) {
    const m = child.margin ?? [0, 0, 0, 0]

    if (dir === "row") {
      child.x = originMain + cursorMain + m[3]
      child.y = originCross + m[0]
      cursorMain += child.width + m[1] + m[3]
    } else {
      child.y = originMain + cursorMain + m[0]
      child.x = originCross + m[3]
      cursorMain += child.height + m[0] + m[2]
    }

    child.x = Math.max(0, child.x)
    child.y = Math.max(0, child.y)
    child.width = Math.max(0, child.width)
    child.height = Math.max(0, child.height)

    if (child.children.length > 0) {
      const childDir = child.direction ?? "column"
      const chBw = child.borderWidth ?? 0
      const chPad = child.padding ?? [0, 0, 0, 0]
      const chInnerX = child.x + chBw + chPad[3]
      const chInnerY = child.y + chBw + chPad[0]
      const chInnerW = Math.max(0, child.width - chBw * 2 - chPad[1] - chPad[3])
      const chInnerH = Math.max(0, child.height - chBw * 2 - chPad[0] - chPad[2])

      passDistribute(child, chInnerX, chInnerY, chInnerW, chInnerH, childDir)
    }
  }
}
