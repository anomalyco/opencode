import type { Program } from "estree-jsx"
import { visit } from "estree-util-visit"

// MDX writes Markdown's elements as `<_components.p>` so a provider can replace them. Solid's
// compiler reads a member expression as a component and would call the string "p", so the docs,
// which never replace HTML elements, get plain `<p>` back (also what lets Solid render them as
// static templates).
export default function recmaSolid() {
  return (tree: Program) => {
    visit(tree, (node) => {
      if (node.type !== "JSXOpeningElement" && node.type !== "JSXClosingElement") return
      const name = node.name
      if (name.type !== "JSXMemberExpression" || name.object.type !== "JSXIdentifier") return
      if (name.object.name !== "_components" || !/^[a-z]/.test(name.property.name)) return
      node.name = { type: "JSXIdentifier", name: name.property.name }
    })
  }
}
