import { createScanner, parseTree, type Node } from "jsonc-parser"

export function deduplicate(text: string): string {
  // Parsing gives the last property precedence, but modify() edits the first.
  while (true) {
    const property = findDuplicate(parseTree(text))
    if (property === undefined) return text
    text = removeProperty(text, property)
  }
}

function findDuplicate(node: Node | undefined): Node | undefined {
  if (node?.type === "object") {
    const seen = new Set<string>()
    for (const property of [...(node.children ?? [])].reverse()) {
      const name = property.children?.[0]?.value
      if (seen.has(name)) return property
      seen.add(name)
    }
  }
  for (const child of node?.children ?? []) {
    const duplicate = findDuplicate(child)
    if (duplicate) return duplicate
  }
}

export function removeProperty(text: string, property: Node) {
  const properties = property.parent?.children ?? []
  const index = properties.indexOf(property)
  const end = property.offset + property.length
  const next = properties[index + 1]
  if (next) {
    const comma = findComma(text, end, next.offset)
    if (comma !== undefined) return text.slice(0, property.offset) + text.slice(end, comma) + text.slice(comma + 1)
  }
  const previous = properties[index - 1]
  if (previous) {
    const comma = findComma(text, previous.offset + previous.length, property.offset)
    if (comma !== undefined) return text.slice(0, comma) + text.slice(comma + 1, property.offset) + text.slice(end)
  }
  const comma = findComma(text, end, (property.parent?.offset ?? 0) + (property.parent?.length ?? 0))
  if (comma !== undefined) return text.slice(0, property.offset) + text.slice(end, comma) + text.slice(comma + 1)
  return text.slice(0, property.offset) + text.slice(end)
}

function findComma(text: string, start: number, end: number) {
  const scanner = createScanner(text, false)
  scanner.setPosition(start)
  while (true) {
    scanner.scan()
    const offset = scanner.getTokenOffset()
    if (scanner.getTokenLength() === 0 || offset >= end) return
    if (text[offset] === ",") return offset
  }
}
