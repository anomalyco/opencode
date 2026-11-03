interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  attributes?: { name?: string; value?: unknown }[]
  children?: HastNode[]
}

// Wide Markdown tables would otherwise widen the whole page on small screens.
export default function rehypeTableScroll() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (isScroller(node)) return
      node.children = node.children?.map((child) =>
        child.type === "element" && child.tagName === "table"
          ? {
              type: "element",
              tagName: "div",
              properties: { className: ["docs-table-scroll"], tabIndex: 0 },
              children: [child],
            }
          : child,
      )
      node.children?.forEach(visit)
    }

    visit(tree)
  }
}

// Some pages already wrap tables by hand in an MDX `<div class="docs-table-scroll">`.
function isScroller(node: HastNode) {
  const className = node.properties?.className
  if (Array.isArray(className) && className.includes("docs-table-scroll")) return true
  return !!node.attributes?.some(
    (attribute) =>
      (attribute.name === "class" || attribute.name === "className") &&
      typeof attribute.value === "string" &&
      attribute.value.split(/\s+/).includes("docs-table-scroll"),
  )
}
