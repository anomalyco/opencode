import type { Element, Root } from "hast"
import Slugger from "github-slugger"
import type { MdxJsxTextElementHast } from "mdast-util-mdx-jsx"
import { visit } from "unist-util-visit"
import type { VFile } from "vfile"

export type DocsHeading = { depth: number; slug: string; text: string }

// Gives every heading a GitHub-style id (as Astro did, so existing anchors keep working) and records
// them in `file.data.headings` for the Contents rail. The text of each h2 and h3 goes inside the
// site's HeadingLink (component/site/on-this-page.tsx): a click copies the section's address.
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
      const link: MdxJsxTextElementHast = {
        type: "mdxJsxTextElement",
        name: "HeadingLink",
        attributes: [
          { type: "mdxJsxAttribute", name: "id", value: slug },
          { type: "mdxJsxAttribute", name: "title", value: text },
        ],
        children: node.children as MdxJsxTextElementHast["children"],
      }
      node.children = [link as unknown as Element]
      return "skip"
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
