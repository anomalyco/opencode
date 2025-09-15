export function getCharacterOffsetInLine(lineElement: Element, targetNode: Node, offset: number): number {
  const r = document.createRange()
  r.selectNodeContents(lineElement)
  r.setEnd(targetNode, offset)
  return r.toString().length
}

export function getNodeOffsetInLine(lineElement: Element, charIndex: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null)
  let remaining = Math.max(0, charIndex)
  let lastText: Node | null = null
  let lastLen = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length || 0
    lastText = node
    lastLen = len
    if (remaining <= len) return { node, offset: remaining }
    remaining -= len
  }
  if (lastText) return { node: lastText, offset: lastLen }
  if (lineElement.firstChild) return { node: lineElement.firstChild, offset: 0 }
  return null
}

export function getSelectionInContainer(
  container: HTMLElement,
): { sl: number; sch: number; el: number; ech: number } | null {
  const s = window.getSelection()
  if (!s || s.rangeCount === 0) return null
  const r = s.getRangeAt(0)
  const sc = r.startContainer
  const ec = r.endContainer
  const getLineElement = (n: Node) =>
    (n.nodeType === Node.TEXT_NODE ? (n.parentElement as Element) : (n as Element))?.closest(".line")
  const sle = getLineElement(sc)
  const ele = getLineElement(ec)
  if (!sle || !ele) return null
  if (!container.contains(sle as Node) || !container.contains(ele as Node)) return null
  const cc = container.querySelector("code") as HTMLElement | null
  if (!cc) return null
  const lines = Array.from(cc.querySelectorAll(".line"))
  const sli = lines.indexOf(sle as Element)
  const eli = lines.indexOf(ele as Element)
  if (sli === -1 || eli === -1) return null
  const sl = sli + 1
  const el = eli + 1
  const sch = getCharacterOffsetInLine(sle as Element, sc, r.startOffset)
  const ech = getCharacterOffsetInLine(ele as Element, ec, r.endOffset)
  return { sl, sch, el, ech }
}
