interface MarkdownNode {
  type: string
  url?: string
  children?: MarkdownNode[]
}

export default function remarkDocsLinks(options: { base: string }) {
  const docsBase = `${options.base.replace(/\/$/, "")}/docs`

  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "link" && node.url?.startsWith("/")) node.url = `${docsBase}${node.url}`
      node.children?.forEach(visit)
    }

    visit(tree)
  }
}
