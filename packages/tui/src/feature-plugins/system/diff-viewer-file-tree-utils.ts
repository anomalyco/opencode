export type FileTreeItem = {
  readonly file: string
  readonly status?: "added" | "deleted" | "modified"
}

export type FileTreeNode = {
  readonly id: number
  readonly name: string
  readonly parent: number | undefined
  readonly children: number[]
  readonly depth: number
  readonly kind: "directory" | "file"
  readonly fileIndex?: number
}

export type FileTree = {
  readonly roots: number[]
  readonly nodes: FileTreeNode[]
}

export type FileTreeRow = {
  readonly id: number
  readonly depth: number
  readonly kind: "directory" | "file"
  readonly name: string
  readonly fileIndex?: number
}

export function buildFileTree(files: readonly FileTreeItem[]): FileTree {
  const roots: number[] = []
  const nodes: FileTreeNode[] = []
  const directoryByPath = new Map<string, number>()

  files.forEach((file, fileIndex) => {
    const segments = file.file.split("/").filter(Boolean)
    if (segments.length === 0) return

    const parent = segments.slice(0, -1).reduce(
      (state, segment) => {
        const directoryPath = state.path ? `${state.path}/${segment}` : segment
        const existing = directoryByPath.get(directoryPath)
        if (existing !== undefined) return { id: existing, path: directoryPath, depth: state.depth + 1 }

        const id = addFileTreeNode(nodes, roots, {
          name: segment,
          parent: state.id,
          depth: state.depth,
          kind: "directory",
        })
        directoryByPath.set(directoryPath, id)
        return { id, path: directoryPath, depth: state.depth + 1 }
      },
      { id: undefined as number | undefined, path: "", depth: 0 },
    )

    addFileTreeNode(nodes, roots, {
      name: segments[segments.length - 1]!,
      parent: parent.id,
      depth: parent.depth,
      kind: "file",
      fileIndex,
    })
  })

  const tree = { roots, nodes }
  tree.roots.sort((left, right) => compareFileTreeNodes(tree, left, right))
  tree.nodes.forEach((node) => node.children.sort((left, right) => compareFileTreeNodes(tree, left, right)))
  return tree
}

export function flattenFileTree(tree: FileTree, expanded?: ReadonlySet<number>): FileTreeRow[] {
  const rows: FileTreeRow[] = []
  const visit = (id: number, depth: number) => {
    const node = tree.nodes[id]!
    if (node.kind === "file") {
      rows.push({
        id: node.id,
        depth,
        kind: node.kind,
        name: node.name,
        fileIndex: node.fileIndex,
      })
      return
    }

    const chain = collapsedFileTreeDirectoryChain(tree, node.id)
    const last = chain[chain.length - 1]!
    rows.push({
      id: node.id,
      depth,
      kind: node.kind,
      name: chain.map((item) => item.name).join("/"),
      fileIndex: node.fileIndex,
    })
    if (!expanded || expanded.has(node.id)) last.children.forEach((child) => visit(child, depth + 1))
  }
  tree.roots.forEach((root) => visit(root, 0))
  return rows
}

function collapsedFileTreeDirectoryChain(tree: FileTree, id: number): FileTreeNode[] {
  const node = tree.nodes[id]!
  const child = node.children.length === 1 ? tree.nodes[node.children[0]!] : undefined
  if (child?.kind !== "directory") return [node]
  return [node, ...collapsedFileTreeDirectoryChain(tree, child.id)]
}

export function compareFileTreeNodes(tree: FileTree, left: number, right: number) {
  const leftNode = tree.nodes[left]!
  const rightNode = tree.nodes[right]!
  if (leftNode.kind !== rightNode.kind) return leftNode.kind === "directory" ? -1 : 1
  if (leftNode.name < rightNode.name) return -1
  if (leftNode.name > rightNode.name) return 1
  return left - right
}

export function fileTreeFileSelection(tree: FileTree, fileIndex: number) {
  const node = tree.nodes.find((item) => item.kind === "file" && item.fileIndex === fileIndex)
  if (!node) return undefined
  return {
    expandedNodes: fileTreeParentDirectories(tree, node.id),
  }
}

export function singlePatchFileIndex(
  selected: number | undefined,
  current: number | undefined,
  first: number | undefined,
) {
  return selected ?? current ?? first
}

export function orderedPatchFileIndexes(rows: readonly FileTreeRow[]) {
  return rows.flatMap((row) => (row.fileIndex === undefined ? [] : [row.fileIndex]))
}

export function showDiffViewerFileTree(showFileTree: boolean, fileCount: number) {
  return showFileTree && fileCount > 0
}

export function movePatchFileIndex(fileIndexes: readonly number[], current: number | undefined, offset: number) {
  if (fileIndexes.length === 0) return undefined
  const index = current === undefined ? -1 : fileIndexes.indexOf(current)
  if (index === -1) return fileIndexes[0]
  return fileIndexes[Math.max(0, Math.min(fileIndexes.length - 1, index + offset))]
}

export function allExpandedFileTreeDirectories(tree: FileTree) {
  return new Set(tree.nodes.filter((node) => node.kind === "directory").map((node) => node.id))
}

export function toggleFileTreeDirectory(tree: FileTree, expanded: ReadonlySet<number>, selected: number | undefined) {
  if (selected === undefined || tree.nodes[selected]?.kind !== "directory") return expanded
  const next = new Set(expanded)
  if (next.has(selected)) next.delete(selected)
  else next.add(selected)
  return next
}

function addFileTreeNode(nodes: FileTreeNode[], roots: number[], input: Omit<FileTreeNode, "id" | "children">) {
  const id = nodes.length
  nodes.push({ ...input, id, children: [] })
  if (input.parent === undefined) roots.push(id)
  else nodes[input.parent]!.children.push(id)
  return id
}

function fileTreeParentDirectories(tree: FileTree, id: number) {
  const result = new Set<number>()
  for (let parent = tree.nodes[id]?.parent; parent !== undefined; parent = tree.nodes[parent]?.parent) {
    result.add(parent)
  }
  return result
}
