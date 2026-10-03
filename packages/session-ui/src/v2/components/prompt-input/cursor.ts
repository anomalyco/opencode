const elementNode = 1
const textNode = 3

export function promptInputV2Cursor(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
    return promptInputV2CursorOffset(editor, editor, editor.childNodes.length)
  }
  return promptInputV2CursorOffset(editor, selection.anchorNode!, selection.anchorOffset)
}

export function promptInputV2CursorOffset(editor: HTMLElement, anchor: Node, offset: number) {
  let position = 0

  const count = (node: Node) => {
    if (node.nodeType === textNode) {
      position += node.textContent?.length ?? 0
      return
    }
    if (node.nodeType !== elementNode) return
    if ((node as HTMLElement).tagName === "BR") {
      position++
      return
    }
    Array.from(node.childNodes).forEach(count)
  }

  const visit = (node: Node): boolean => {
    if (node === anchor) {
      if (node.nodeType === textNode) position += node.textContent?.slice(0, offset).length ?? 0
      if (node.nodeType === elementNode) Array.from(node.childNodes).slice(0, offset).forEach(count)
      return true
    }
    if (node.nodeType === textNode) {
      count(node)
      return false
    }
    if (node.nodeType !== elementNode) return false
    if ((node as HTMLElement).tagName === "BR") {
      position++
      return false
    }
    return Array.from(node.childNodes).some(visit)
  }

  const nodes = Array.from(editor.childNodes)
  const limit = anchor === editor ? Math.min(offset, nodes.length) : nodes.length
  for (let index = 0; index < limit; index++) {
    const node = nodes[index]!
    if (anchor !== editor && visit(node)) return position
    if (anchor === editor) count(node)
    if (node.nodeType === elementNode && ["DIV", "P"].includes((node as HTMLElement).tagName) && index < nodes.length - 1) {
      position++
    }
  }
  return position
}
