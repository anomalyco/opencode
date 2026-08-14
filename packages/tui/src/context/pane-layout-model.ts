import type { GroupItem } from "@opencode-ai/client"

export type PaneLayoutNode =
  | { type: "item"; item: GroupItem }
  | {
      type: "split"
      direction: "horizontal" | "vertical"
      ratio: number
      first: PaneLayoutNode
      second: PaneLayoutNode
    }

export function defaultPaneLayout(items: readonly GroupItem[]): PaneLayoutNode | undefined {
  const master = items[0]
  if (!master) return undefined
  const stack = items.slice(1)
  if (stack.length === 0) return { type: "item", item: master }
  return {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: { type: "item", item: master },
    second: stackLayout(stack),
  }
}

function stackLayout(items: readonly GroupItem[]): PaneLayoutNode {
  const first = items[0]
  if (items.length === 1) return { type: "item", item: first }
  return {
    type: "split",
    direction: "vertical",
    ratio: 1 / items.length,
    first: { type: "item", item: first },
    second: stackLayout(items.slice(1)),
  }
}

export function paneLayoutItems(node: PaneLayoutNode): GroupItem[] {
  if (node.type === "item") return [node.item]
  return paneLayoutItems(node.first).concat(paneLayoutItems(node.second))
}

export function removePaneLayoutItem(node: PaneLayoutNode, item: GroupItem): PaneLayoutNode | undefined {
  if (node.type === "item") return itemKey(node.item) === itemKey(item) ? undefined : node
  const first = removePaneLayoutItem(node.first, item)
  const second = removePaneLayoutItem(node.second, item)
  if (!first) return second
  if (!second) return first
  if (first === node.first && second === node.second) return node
  return { ...node, first, second }
}

export function reconcilePaneLayout(node: PaneLayoutNode | undefined, items: readonly GroupItem[]) {
  if (!node) return defaultPaneLayout(items)
  const wanted = new Map(items.map((item) => [itemKey(item), item]))
  const kept = paneLayoutItems(node).filter((item) => wanted.has(itemKey(item)))
  if (kept.length !== items.length || kept.some((item, index) => itemKey(item) !== itemKey(items[index])))
    return defaultPaneLayout(items)
  return replaceItems(node, wanted)
}

function replaceItems(node: PaneLayoutNode, items: ReadonlyMap<string, GroupItem>): PaneLayoutNode {
  if (node.type === "item") return { type: "item", item: items.get(itemKey(node.item)) ?? node.item }
  return { ...node, first: replaceItems(node.first, items), second: replaceItems(node.second, items) }
}

function itemKey(item: GroupItem) {
  return `${item.type}:${item.id}`
}
