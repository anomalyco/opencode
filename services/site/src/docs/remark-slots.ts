import type { Root } from "mdast"
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx-jsx"
import { visit } from "unist-util-visit"

// Named slots, as in Astro: inside a component, `<div slot="go">…</div>` becomes
// `<Slot name="go"><div>…</div></Slot>`, and the component picks each slot's content with
// `<SlotScope name="go">` (components/Slot.tsx).
export default function remarkSlots() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (!isJsx(node) || !node.name || !/^[A-Z]/.test(node.name)) return
      node.children = node.children.map((child) => {
        if (!isJsx(child)) return child
        const slot = child.attributes.find(
          (attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === "slot",
        )
        if (!slot || typeof slot.value !== "string") return child
        return {
          ...child,
          name: "Slot",
          attributes: [{ type: "mdxJsxAttribute", name: "name", value: slot.value }],
          children: [{ ...child, attributes: child.attributes.filter((attribute) => attribute !== slot) }],
        } as typeof child
      }) as typeof node.children
    })
  }
}

function isJsx(node: unknown): node is MdxJsxFlowElement | MdxJsxTextElement {
  const type = (node as { type?: string }).type
  return type === "mdxJsxFlowElement" || type === "mdxJsxTextElement"
}
