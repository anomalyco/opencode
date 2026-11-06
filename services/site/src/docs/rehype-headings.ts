import type { Element, Root } from "hast"
import Slugger from "github-slugger"
import { visit } from "unist-util-visit"
import type { VFile } from "vfile"

export type DocsHeading = { depth: number; slug: string; text: string }

// Gives every heading a GitHub-style id (as Astro did, so existing anchors keep working), records
// them in `file.data.headings` for the table of contents, and appends a hover `#` link to h2 and h3.
// The link is ignored by Pagefind so search excerpts and sub-results read as before.
export default function rehypeHeadings() {
  return (tree: Root, file: VFile) => {
    const slugger = new Slugger()
    const headings: DocsHeading[] = []
    visit(tree, "element", (node: Element) => {
      const depth = Number(/^h([1-6])$/.exec(node.tagName)?.[1])
      if (!depth) return
      const text = headingText(node)
      if (typeof node.properties.id !== "string") node.properties.id = slugger.slug(text)
      const slug = node.properties.id as string
      headings.push({ depth, slug, text })
      if (depth !== 2 && depth !== 3) return
      node.children.push({
        type: "element",
        tagName: "a",
        properties: {
          className: ["heading-anchor"],
          href: `#${slug}`,
          ariaLabel: `Link to ${text}`,
          dataPagefindIgnore: "",
        },
        children: [{ type: "text", value: "#" }],
      })
    })
    file.data.headings = headings
  }
}

// The heading's text, MDX expressions included as written.
function headingText(node: Element) {
  let text = ""
  visit(node, (child) => {
    if (child.type === "text" || child.type === "raw" || child.type === "mdxTextExpression")
      text += (child as { value: string }).value
  })
  return text
}
