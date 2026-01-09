import path from "path"

export const DEFAULT_TREE_LIMIT = 50

export interface TreeNode {
  path: string[]
  children: TreeNode[]
}

export function getOrCreateNode(root: TreeNode, parts: string[], create: boolean): TreeNode | undefined {
  if (parts.length === 0) return root
  let current = root
  for (const part of parts) {
    let child = current.children.find((c) => c.path.at(-1) === part)
    if (!child) {
      if (!create) return undefined
      child = { path: current.path.concat(part), children: [] }
      current.children.push(child)
    }
    current = child
  }
  return current
}

export function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { path: [], children: [] }
  for (const file of files) {
    if (file.includes(".opencode")) continue
    getOrCreateNode(root, file.split(path.sep), true)
  }
  return root
}

export function sortTreeInPlace(node: TreeNode): void {
  node.children.sort((a, b) => {
    const aIsDir = a.children.length > 0
    const bIsDir = b.children.length > 0
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
    return a.path.at(-1)!.localeCompare(b.path.at(-1)!)
  })
  for (const child of node.children) {
    sortTreeInPlace(child)
  }
}

export function truncateBFS(source: TreeNode, limit: number): TreeNode {
  const result: TreeNode = { path: [], children: [] }
  let queue = [source]
  let processed = 0

  while (queue.length > 0 && processed < limit) {
    const nextQueue: TreeNode[] = []

    for (const node of queue) {
      if (node.children.length > 0) {
        nextQueue.push(...node.children)
      }
    }

    const maxChildren = Math.max(...queue.map((n) => n.children.length))
    for (let i = 0; i < maxChildren && processed < limit; i++) {
      for (const node of queue) {
        const child = node.children[i]
        if (!child) continue
        getOrCreateNode(result, child.path, true)
        processed++
        if (processed >= limit) break
      }
    }

    if (processed >= limit) {
      for (const node of [...queue, ...nextQueue]) {
        const resultNode = getOrCreateNode(result, node.path, false)
        if (!resultNode) continue
        const truncatedCount = node.children.length - resultNode.children.length
        if (truncatedCount > 0) {
          resultNode.children.push({
            path: resultNode.path.concat(`[${truncatedCount} truncated]`),
            children: [],
          })
        }
      }
      break
    }

    queue = nextQueue
  }

  return result
}

export function renderTree(node: TreeNode): string {
  const lines: string[] = []

  function render(n: TreeNode, depth: number) {
    const name = n.path.at(-1)
    const suffix = n.children.length > 0 ? "/" : ""
    lines.push("\t".repeat(depth) + name + suffix)
    for (const child of n.children) {
      render(child, depth + 1)
    }
  }

  for (const child of node.children) {
    render(child, 0)
  }

  return lines.join("\n")
}
