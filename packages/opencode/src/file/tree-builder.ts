import path from "path"

export namespace TreeBuilder {
  interface TreeNode {
    path: string[]
    children: Map<string, TreeNode>
  }

  interface SerializedNode {
    path: string[]
    children: SerializedNode[]
  }

  export interface TreeOptions {
    limit?: number
    sortFn?: (a: SerializedNode, b: SerializedNode) => number
  }

  const DEFAULT_LIMIT = 50
  const DEFAULT_SORT = (a: SerializedNode, b: SerializedNode): number => {
    const aIsFile = a.children.length === 0
    const bIsFile = b.children.length === 0
    if (aIsFile && !bIsFile) return 1
    if (!aIsFile && bIsFile) return -1
    return a.path.at(-1)!.localeCompare(b.path.at(-1)!)
  }

  export function build(files: string[], options: TreeOptions = {}): string {
    const { limit = DEFAULT_LIMIT, sortFn = DEFAULT_SORT } = options
    
    const root = buildTree(files)
    const sortedRoot = sortTree(root, sortFn)
    const truncatedRoot = applyLimit(sortedRoot, limit)
    
    return render(truncatedRoot)
  }

  function buildTree(files: string[]): TreeNode {
    const root: TreeNode = {
      path: [],
      children: new Map(),
    }

    for (const file of files) {
      if (file.includes(".opencode")) continue
      const parts = file.split(path.sep)
      let current = root

      for (const part of parts) {
        let child = current.children.get(part)

        if (!child) {
          child = {
            path: [...current.path, part],
            children: new Map(),
          }
          current.children.set(part, child)
        }
        current = child
      }
    }

    return root
  }

  function sortTree(node: TreeNode, sortFn: (a: SerializedNode, b: SerializedNode) => number): SerializedNode {
    const sortedChildren = Array.from(node.children.values())
      .map(child => sortTree(child, sortFn))
      .sort(sortFn)

    return {
      path: node.path,
      children: sortedChildren,
    }
  }

  function applyLimit(root: SerializedNode, limit: number): SerializedNode {
    const result: SerializedNode = {
      path: [],
      children: [],
    }

    const nodeMap = new Map<string, SerializedNode>()
    const queue = [root]
    let processed = 0

    while (queue.length > 0 && processed < limit) {
      const batch = queue.splice(0, queue.length)
      
      for (const node of batch) {
        if (node.children.length) {
          queue.push(...node.children)
        }
      }

      for (const node of batch) {
        if (processed >= limit) break
        
        for (const child of node.children) {
          if (processed >= limit) break
          
          const parent = getOrCreateNode(result, nodeMap, child.path.slice(0, -1))
          parent.children.push({
            path: child.path,
            children: [],
          })
          processed++
        }
      }
    }

    // Add truncation indicators
    addTruncationIndicators(result, root, nodeMap)

    return result
  }

  function getOrCreateNode(
    root: SerializedNode,
    nodeMap: Map<string, SerializedNode>,
    path: string[]
  ): SerializedNode {
    const key = path.join('/')
    const cached = nodeMap.get(key)
    if (cached) return cached

    let current = root
    for (const part of path) {
      let child = current.children.find(c => c.path.at(-1) === part)
      if (!child) {
        child = {
          path: [...current.path, part],
          children: [],
        }
        current.children.push(child)
      }
      current = child
    }

    nodeMap.set(key, current)
    return current
  }

  function addTruncationIndicators(
    truncated: SerializedNode,
    original: SerializedNode,
    nodeMap: Map<string, SerializedNode>
  ): void {
    const queue = [{ truncated, original }]

    while (queue.length > 0) {
      const { truncated: t, original: o } = queue.shift()!

      if (t.children.length < o.children.length) {
        const diff = o.children.length - t.children.length
        t.children.push({
          path: [...t.path, `[${diff} truncated]`],
          children: [],
        })
      }

      for (const tChild of t.children) {
        const oChild = o.children.find(c => c.path.join('/') === tChild.path.join('/'))
        if (oChild && tChild.children.length > 0) {
          queue.push({ truncated: tChild, original: oChild })
        }
      }
    }
  }

  function render(node: SerializedNode): string {
    const lines: string[] = []
    
    function renderNode(node: SerializedNode, depth: number): void {
      const indent = "\t".repeat(depth)
      const name = node.path.at(-1) || ''
      const suffix = node.children.length ? "/" : ""
      
      if (name) {
        lines.push(indent + name + suffix)
      }
      
      for (const child of node.children) {
        renderNode(child, depth + 1)
      }
    }

    for (const child of node.children) {
      renderNode(child, 0)
    }

    return lines.join("\n")
  }
}