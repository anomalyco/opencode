import type { Doc } from "@blocksuite/store"

function add(doc: Doc, flavour: string, id: string, parent?: string) {
  return doc.addBlock(flavour as never, { id }, parent)
}

export function initDoc(doc: Doc) {
  doc.load()
  if (doc.root) return
  doc.withoutTransact(() => {
    const root = add(doc, "affine:page", "prompt-page")
    add(doc, "affine:surface", "prompt-surface", root)
    const note = add(doc, "affine:note", "prompt-note", root)
    add(doc, "affine:paragraph", "prompt-paragraph", note)
  })
}
