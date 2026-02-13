import { createSimpleContext } from "./helper"

export type PaneDir = "h" | "v"

export type PaneNode<Meta> =
  | { type: "leaf"; id: string; meta?: Meta }
  | {
      type: "split"
      id: string
      direction: PaneDir
      children: [PaneNode<Meta>, PaneNode<Meta>]
      size: number
      meta?: Meta
    }

export type Container<Meta> = {
  id: string
  root?: PaneNode<Meta>
  parentId?: string
  children: string[]
  meta?: Meta
}

export type LayoutRect = {
  x: number
  y: number
  width: number
  height: number
}

export type RenderNode<Meta> = {
  id: string
  type: "leaf" | "split"
  meta?: Meta
  rect: LayoutRect
  depth: number
  path: string
  isActive?: boolean
  isFocused?: boolean
  splitDirection?: PaneDir
  splitPosition?: number
  children?: [RenderNode<Meta>, RenderNode<Meta>]
}

export type RenderTree<Meta> = {
  containerId: string
  root?: RenderNode<Meta>
}

export type Layout<Meta> = {
  containers: Record<string, Container<Meta>>
  activeContainerId?: string
  focusedNodeId: Record<string, string | undefined>
}

type Listener<Meta> = (tree: RenderTree<Meta>) => void

type MoveOpts = { index?: number }

type Op<Meta> =
  | { type: "create-container"; id: string; parentId?: string; meta?: Meta; index?: number }
  | { type: "delete-container"; id: string }
  | { type: "move-container"; id: string; parentId?: string; index?: number }
  | { type: "reorder-containers"; parentId: string; order: string[] }
  | { type: "update-container-meta"; id: string; meta?: Meta }
  | { type: "create-node"; containerId: string; nodeId: string; meta?: Meta }
  | { type: "split-node"; containerId: string; nodeId: string; newNodeId: string; direction: PaneDir; meta?: Meta }
  | { type: "delete-node"; containerId: string; nodeId: string }
  | { type: "resize-split"; containerId: string; splitId: string; size: number }
  | { type: "swap-nodes"; containerId: string; a: string; b: string }
  | {
      type: "move-node"
      nodeId: string
      fromContainerId: string
      toContainerId: string
      targetNodeId?: string
      direction?: PaneDir
    }
  | { type: "focus-container"; containerId: string }
  | { type: "focus-node"; containerId: string; nodeId: string }

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const uniq = (id: string, has: (id: string) => boolean) => {
  if (!has(id)) return id
  let n = 1
  for (;;) {
    const next = `${id}-${n}`
    if (!has(next)) return next
    n += 1
  }
}

const walk = <Meta,>(root: PaneNode<Meta> | undefined, fn: (n: PaneNode<Meta>, p: PaneNode<Meta> | undefined) => void) => {
  if (!root) return
  const rec = (n: PaneNode<Meta>, p: PaneNode<Meta> | undefined) => {
    fn(n, p)
    if (n.type !== "split") return
    rec(n.children[0], n)
    rec(n.children[1], n)
  }
  rec(root, undefined)
}

const get = <Meta,>(root: PaneNode<Meta> | undefined, id: string) => {
  let found: PaneNode<Meta> | undefined
  walk(root, (n) => {
    if (found) return
    if (n.id !== id) return
    found = n
  })
  return found
}

const includes = <Meta,>(root: PaneNode<Meta> | undefined, id: string) => !!get(root, id)

const leaves = <Meta,>(root: PaneNode<Meta> | undefined) => {
  const out: PaneNode<Meta>[] = []
  walk(root, (n) => {
    if (n.type !== "leaf") return
    out.push(n)
  })
  return out
}

const findpath = <Meta,>(root: PaneNode<Meta> | undefined, id: string) => {
  if (!root) return
  const rec = (n: PaneNode<Meta>, path: number[]): number[] | undefined => {
    if (n.id === id) return path
    if (n.type !== "split") return
    return rec(n.children[0], [...path, 0]) ?? rec(n.children[1], [...path, 1])
  }
  return rec(root, [0])
}

const replace = <Meta,>(root: PaneNode<Meta>, id: string, next: PaneNode<Meta>) => {
  const rec = (n: PaneNode<Meta>): PaneNode<Meta> => {
    if (n.id === id) return next
    if (n.type !== "split") return n
    return { ...n, children: [rec(n.children[0]), rec(n.children[1])] as [PaneNode<Meta>, PaneNode<Meta>] }
  }
  return rec(root)
}

const remove = <Meta,>(root: PaneNode<Meta> | undefined, id: string): PaneNode<Meta> | undefined => {
  if (!root) return
  const rec = (n: PaneNode<Meta>): PaneNode<Meta> | undefined => {
    if (n.type === "leaf") return n.id === id ? undefined : n
    const a = rec(n.children[0])
    const b = rec(n.children[1])
    if (!a && !b) return
    if (!a) return b
    if (!b) return a
    return { ...n, children: [a, b] as [PaneNode<Meta>, PaneNode<Meta>], size: clamp(n.size, 0.1, 0.9) }
  }
  return rec(root)
}

const swap = <Meta,>(root: PaneNode<Meta>, a: string, b: string) => {
  const na = get(root, a)
  const nb = get(root, b)
  if (!na || na.type !== "leaf") return root
  if (!nb || nb.type !== "leaf") return root

  const rec = (n: PaneNode<Meta>): PaneNode<Meta> => {
    if (n.id === a) return { ...nb }
    if (n.id === b) return { ...na }
    if (n.type !== "split") return n
    return { ...n, children: [rec(n.children[0]), rec(n.children[1])] as [PaneNode<Meta>, PaneNode<Meta>] }
  }
  return rec(root)
}

const render = <Meta,>(input: {
  node: PaneNode<Meta>
  rect: LayoutRect
  depth: number
  path: string
  active?: string
  focused?: boolean
}): RenderNode<Meta> => {
  if (input.node.type === "leaf") {
    return {
      id: input.node.id,
      type: "leaf",
      meta: input.node.meta,
      rect: input.rect,
      depth: input.depth,
      path: input.path,
      isActive: input.node.id === input.active,
      isFocused: input.focused && input.node.id === input.active,
    }
  }

  const a = input.node.children[0]
  const b = input.node.children[1]
  const size = clamp(input.node.size, 0.1, 0.9)

  const rectA =
    input.node.direction === "v"
      ? { x: input.rect.x, y: input.rect.y, width: input.rect.width * size, height: input.rect.height }
      : { x: input.rect.x, y: input.rect.y, width: input.rect.width, height: input.rect.height * size }
  const rectB =
    input.node.direction === "v"
      ? {
          x: input.rect.x + input.rect.width * size,
          y: input.rect.y,
          width: input.rect.width * (1 - size),
          height: input.rect.height,
        }
      : {
          x: input.rect.x,
          y: input.rect.y + input.rect.height * size,
          width: input.rect.width,
          height: input.rect.height * (1 - size),
        }
  const pos = input.node.direction === "v" ? rectB.x : rectB.y

  return {
    id: input.node.id,
    type: "split",
    meta: input.node.meta,
    rect: input.rect,
    depth: input.depth,
    path: input.path,
    splitDirection: input.node.direction,
    splitPosition: pos,
    children: [
      render({
        node: a,
        rect: rectA,
        depth: input.depth + 1,
        path: `${input.path}.0`,
        active: input.active,
        focused: input.focused,
      }),
      render({
        node: b,
        rect: rectB,
        depth: input.depth + 1,
        path: `${input.path}.1`,
        active: input.active,
        focused: input.focused,
      }),
    ] as [RenderNode<Meta>, RenderNode<Meta>],
  }
}

const center = (r: LayoutRect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

export type PaneManager<Meta> = {
  createContainer: (id: string, parentId?: string, meta?: Meta) => Promise<void>
  deleteContainer: (id: string) => Promise<void>
  moveContainer: (id: string, parentId?: string, opts?: MoveOpts) => Promise<void>
  reorderContainers: (parentId: string, order: string[]) => Promise<void>
  updateContainerMeta: (id: string, meta?: Meta) => Promise<void>

  createNode: (containerId: string, nodeId: string, meta?: Meta) => Promise<void>
  splitNode: (containerId: string, nodeId: string, newNodeId: string, direction: PaneDir, meta?: Meta) => Promise<string>
  deleteNode: (containerId: string, nodeId: string) => Promise<void>
  resizeSplit: (containerId: string, splitId: string, size: number) => Promise<void>
  swapNodes: (containerId: string, a: string, b: string) => Promise<void>
  moveNode: (
    nodeId: string,
    fromContainerId: string,
    toContainerId: string,
    targetNodeId?: string,
    direction?: PaneDir,
  ) => Promise<void>

  focusContainer: (containerId: string) => Promise<void>
  focusNode: (containerId: string, nodeId: string) => Promise<void>
  getActiveContainer: () => Promise<string | undefined>
  getActiveNode: (containerId: string) => Promise<string | undefined>

  getChildren: (id: string) => Promise<string[]>
  getParent: (id: string) => Promise<string | undefined>
  getSiblings: (id: string) => Promise<string[]>
  getAncestors: (id: string) => Promise<string[]>
  getDescendants: (id: string) => Promise<string[]>

  getNode: (containerId: string, nodeId: string) => Promise<PaneNode<Meta> | undefined>
  getAllNodes: (containerId: string) => Promise<PaneNode<Meta>[]>
  getNodePath: (containerId: string, nodeId: string) => Promise<string | undefined>
  findNodes: (containerId: string, pred: (node: PaneNode<Meta>) => boolean) => Promise<PaneNode<Meta>[]>

  getRenderTree: (containerId: string) => Promise<RenderTree<Meta>>
  onLayoutChange: (containerId: string, fn: Listener<Meta>) => () => void

  navigate: (
    containerId: string,
    fromNodeId: string,
    dir: "up" | "down" | "left" | "right" | "parent" | "child",
  ) => Promise<string | undefined>

  applyOperations: (ops: Op<Meta>[]) => Promise<void>

  getLayout: () => Promise<Layout<Meta>>
  setLayout: (layout: Layout<Meta>) => Promise<void>
}

export const createPaneManager = <Meta,>(seed?: Layout<Meta>): PaneManager<Meta> => {
  const containers = new Map<string, Container<Meta>>(
    Object.entries(seed?.containers ?? {}).map(([id, c]) => [id, { ...c, id, children: [...(c.children ?? [])] }]),
  )
  const focus = new Map<string, string | undefined>(Object.entries(seed?.focusedNodeId ?? {}))
  const active = { id: seed?.activeContainerId }
  const listeners = new Map<string, Set<Listener<Meta>>>()

  const emit = (id: string) => {
    const set = listeners.get(id)
    if (!set || set.size === 0) return
    const tree = getRenderTree(id)
    set.forEach((fn) => fn(tree))
  }

  const getContainer = (id: string) => {
    const c = containers.get(id)
    if (!c) throw new Error(`container not found: ${id}`)
    return c
  }

  const detach = (id: string) => {
    const c = getContainer(id)
    if (!c.parentId) return
    const parent = getContainer(c.parentId)
    parent.children = parent.children.filter((x) => x !== id)
    c.parentId = undefined
  }

  const attach = (id: string, parentId: string, index?: number) => {
    const c = getContainer(id)
    const parent = getContainer(parentId)
    c.parentId = parentId
    const at = index === undefined ? parent.children.length : clamp(index, 0, parent.children.length)
    parent.children = [...parent.children.slice(0, at), id, ...parent.children.slice(at)]
  }

  const getRenderTree = (containerId: string): RenderTree<Meta> => {
    const c = containers.get(containerId)
    if (!c) return { containerId }
    const root = c.root
    if (!root) return { containerId }
    return {
      containerId,
      root: render({
        node: root,
        rect: { x: 0, y: 0, width: 100, height: 100 },
        depth: 0,
        path: "0",
        active: focus.get(containerId),
        focused: active.id === containerId,
      }),
    }
  }

  const ops = {
    createContainer(id: string, parentId?: string, meta?: Meta, index?: number) {
      if (containers.has(id)) return
      containers.set(id, { id, parentId, meta, children: [] })
      if (!parentId) return
      attach(id, parentId, index)
    },

    deleteContainer(id: string) {
      const root = containers.get(id)
      if (!root) return
      const todo = [id]
      const ids: string[] = []
      while (todo.length) {
        const cur = todo.pop()
        if (!cur) continue
        const c = containers.get(cur)
        if (!c) continue
        ids.push(cur)
        todo.push(...c.children)
      }

      ids.forEach((cid) => detach(cid))
      ids.forEach((cid) => {
        containers.delete(cid)
        focus.delete(cid)
        listeners.delete(cid)
      })

      if (active.id && ids.includes(active.id)) active.id = undefined
    },

    moveContainer(id: string, parentId?: string, index?: number) {
      if (!containers.has(id)) throw new Error(`container not found: ${id}`)
      detach(id)
      if (!parentId) return
      attach(id, parentId, index)
    },

    reorderContainers(parentId: string, order: string[]) {
      const parent = getContainer(parentId)
      const set = new Set(parent.children)
      const next = order.filter((id) => set.has(id))
      const rest = parent.children.filter((id) => !next.includes(id))
      parent.children = [...next, ...rest]
    },

    updateContainerMeta(id: string, meta?: Meta) {
      const c = getContainer(id)
      c.meta = meta
    },

    createNode(containerId: string, nodeId: string, meta?: Meta) {
      const c = getContainer(containerId)
      if (c.root) throw new Error(`container already has root: ${containerId}`)
      c.root = { type: "leaf", id: nodeId, meta }
      focus.set(containerId, nodeId)
    },

    splitNode(containerId: string, nodeId: string, newNodeId: string, direction: PaneDir, meta?: Meta) {
      const c = getContainer(containerId)
      const root = c.root
      if (!root) throw new Error(`container has no root: ${containerId}`)
      if (!includes(root, nodeId)) throw new Error(`node not found: ${nodeId}`)
      if (includes(root, newNodeId)) throw new Error(`duplicate node id: ${newNodeId}`)

      const leaf = get(root, nodeId)
      if (!leaf || leaf.type !== "leaf") throw new Error(`node is not a leaf: ${nodeId}`)

      const splitId = uniq(`split-${nodeId}`, (id) => includes(root, id))
      const next = replace(root, nodeId, {
        type: "split",
        id: splitId,
        direction,
        size: 0.5,
        meta: undefined,
        children: [{ ...leaf }, { type: "leaf", id: newNodeId, meta }] as [PaneNode<Meta>, PaneNode<Meta>],
      })
      c.root = next
      focus.set(containerId, newNodeId)
      return splitId
    },

    deleteNode(containerId: string, nodeId: string) {
      const c = getContainer(containerId)
      if (!c.root) return
      c.root = remove(c.root, nodeId)
      const ids = leaves(c.root).map((n) => n.id)
      const current = focus.get(containerId)
      if (current && ids.includes(current)) return
      focus.set(containerId, ids[0])
    },

    resizeSplit(containerId: string, splitId: string, size: number) {
      const c = getContainer(containerId)
      const root = c.root
      if (!root) return
      const node = get(root, splitId)
      if (!node || node.type !== "split") return
      c.root = replace(root, splitId, { ...node, size: clamp(size, 0.1, 0.9) })
    },

    swapNodes(containerId: string, a: string, b: string) {
      const c = getContainer(containerId)
      const root = c.root
      if (!root) return
      if (a === b) return
      if (!includes(root, a)) return
      if (!includes(root, b)) return
      c.root = swap(root, a, b)
    },

    moveNode(nodeId: string, fromContainerId: string, toContainerId: string, targetNodeId?: string, direction?: PaneDir) {
      const from = getContainer(fromContainerId)
      const to = getContainer(toContainerId)
      const root = from.root
      if (!root) return
      const node = get(root, nodeId)
      if (!node || node.type !== "leaf") return

      from.root = remove(root, nodeId)
      const fromIds = leaves(from.root).map((n) => n.id)
      if (!fromIds.includes(focus.get(fromContainerId) ?? "")) focus.set(fromContainerId, fromIds[0])

      if (!to.root) {
        to.root = node
        focus.set(toContainerId, nodeId)
        return
      }

      if (includes(to.root, nodeId)) throw new Error(`duplicate node id in destination: ${nodeId}`)

      const target = targetNodeId ?? focus.get(toContainerId) ?? leaves(to.root)[0]?.id
      const dir = direction ?? "v"
      if (!target) return

      const t = get(to.root, target)
      if (!t || t.type !== "leaf") return
      const splitId = uniq(`split-${target}`, (id) => includes(to.root, id))
      to.root = replace(to.root, target, {
        type: "split",
        id: splitId,
        direction: dir,
        size: 0.5,
        meta: undefined,
        children: [{ ...t }, node] as [PaneNode<Meta>, PaneNode<Meta>],
      })
      focus.set(toContainerId, nodeId)
    },

    focusContainer(containerId: string) {
      if (!containers.has(containerId)) throw new Error(`container not found: ${containerId}`)
      active.id = containerId
    },

    focusNode(containerId: string, nodeId: string) {
      const c = getContainer(containerId)
      if (!c.root) return
      if (!includes(c.root, nodeId)) return
      focus.set(containerId, nodeId)
    },

    navigate(containerId: string, fromNodeId: string, dir: "up" | "down" | "left" | "right" | "parent" | "child") {
      if (dir === "parent") return
      if (dir === "child") return

      const tree = getRenderTree(containerId)
      const root = tree.root
      if (!root) return

      const nodes: RenderNode<Meta>[] = []
      const rec = (n: RenderNode<Meta>) => {
        if (n.type === "leaf") nodes.push(n)
        n.children?.forEach(rec)
      }
      rec(root)

      const cur = nodes.find((n) => n.id === fromNodeId)
      if (!cur) return
      const c = center(cur.rect)

      const next = nodes
        .filter((n) => n.id !== fromNodeId)
        .map((n) => ({ n, c: center(n.rect) }))
        .filter((x) => {
          if (dir === "left") return x.c.x < c.x - 0.0001
          if (dir === "right") return x.c.x > c.x + 0.0001
          if (dir === "up") return x.c.y < c.y - 0.0001
          return x.c.y > c.y + 0.0001
        })
        .map((x) => {
          const dx = x.c.x - c.x
          const dy = x.c.y - c.y
          const dist = Math.hypot(dx, dy)
          const bias = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx)
          return { id: x.n.id, score: dist + bias * 0.25 }
        })
        .sort((a, b) => a.score - b.score)[0]

      return next?.id
    },
  }

  const apply = (op: Op<Meta>) => {
    if (op.type === "create-container") ops.createContainer(op.id, op.parentId, op.meta, op.index)
    if (op.type === "delete-container") ops.deleteContainer(op.id)
    if (op.type === "move-container") ops.moveContainer(op.id, op.parentId, op.index)
    if (op.type === "reorder-containers") ops.reorderContainers(op.parentId, op.order)
    if (op.type === "update-container-meta") ops.updateContainerMeta(op.id, op.meta)
    if (op.type === "create-node") ops.createNode(op.containerId, op.nodeId, op.meta)
    if (op.type === "split-node") ops.splitNode(op.containerId, op.nodeId, op.newNodeId, op.direction, op.meta)
    if (op.type === "delete-node") ops.deleteNode(op.containerId, op.nodeId)
    if (op.type === "resize-split") ops.resizeSplit(op.containerId, op.splitId, op.size)
    if (op.type === "swap-nodes") ops.swapNodes(op.containerId, op.a, op.b)
    if (op.type === "move-node") ops.moveNode(op.nodeId, op.fromContainerId, op.toContainerId, op.targetNodeId, op.direction)
    if (op.type === "focus-container") ops.focusContainer(op.containerId)
    if (op.type === "focus-node") ops.focusNode(op.containerId, op.nodeId)
  }

  const changed = (op: Op<Meta>) => {
    if (op.type === "move-node") return [op.fromContainerId, op.toContainerId]
    if ("containerId" in op) return [op.containerId]
    if (op.type === "create-container") return op.parentId ? [op.parentId, op.id] : [op.id]
    if (op.type === "delete-container") return [op.id]
    if (op.type === "move-container") return [op.id, ...(op.parentId ? [op.parentId] : [])]
    if (op.type === "reorder-containers") return [op.parentId]
    if (op.type === "update-container-meta") return [op.id]
    return []
  }

  const api: PaneManager<Meta> = {
    async createContainer(id, parentId, meta) {
      ops.createContainer(id, parentId, meta)
      if (parentId) emit(parentId)
      emit(id)
    },

    async deleteContainer(id) {
      ops.deleteContainer(id)
      emit(id)
    },

    async moveContainer(id, parentId, opts) {
      const prev = containers.get(id)?.parentId
      ops.moveContainer(id, parentId, opts?.index)
      if (prev) emit(prev)
      if (parentId) emit(parentId)
      emit(id)
    },

    async reorderContainers(parentId, order) {
      ops.reorderContainers(parentId, order)
      emit(parentId)
    },

    async updateContainerMeta(id, meta) {
      ops.updateContainerMeta(id, meta)
      emit(id)
    },

    async createNode(containerId, nodeId, meta) {
      ops.createNode(containerId, nodeId, meta)
      emit(containerId)
    },

    async splitNode(containerId, nodeId, newNodeId, direction, meta) {
      const id = ops.splitNode(containerId, nodeId, newNodeId, direction, meta)
      emit(containerId)
      return id
    },

    async deleteNode(containerId, nodeId) {
      ops.deleteNode(containerId, nodeId)
      emit(containerId)
    },

    async resizeSplit(containerId, splitId, size) {
      ops.resizeSplit(containerId, splitId, size)
      emit(containerId)
    },

    async swapNodes(containerId, a, b) {
      ops.swapNodes(containerId, a, b)
      emit(containerId)
    },

    async moveNode(nodeId, fromContainerId, toContainerId, targetNodeId, direction) {
      ops.moveNode(nodeId, fromContainerId, toContainerId, targetNodeId, direction)
      emit(fromContainerId)
      emit(toContainerId)
    },

    async focusContainer(containerId) {
      ops.focusContainer(containerId)
      emit(containerId)
    },

    async focusNode(containerId, nodeId) {
      ops.focusNode(containerId, nodeId)
      emit(containerId)
    },

    async getActiveContainer() {
      return active.id
    },

    async getActiveNode(containerId) {
      return focus.get(containerId)
    },

    async getChildren(id) {
      return [...getContainer(id).children]
    },

    async getParent(id) {
      return containers.get(id)?.parentId
    },

    async getSiblings(id) {
      const parentId = containers.get(id)?.parentId
      if (!parentId) return []
      return [...getContainer(parentId).children.filter((x) => x !== id)]
    },

    async getAncestors(id) {
      const out: string[] = []
      let cur = containers.get(id)?.parentId
      while (cur) {
        out.push(cur)
        cur = containers.get(cur)?.parentId
      }
      return out
    },

    async getDescendants(id) {
      const out: string[] = []
      const todo = [...getContainer(id).children]
      while (todo.length) {
        const cur = todo.pop()
        if (!cur) continue
        out.push(cur)
        todo.push(...(containers.get(cur)?.children ?? []))
      }
      return out
    },

    async getNode(containerId, nodeId) {
      return get(getContainer(containerId).root, nodeId)
    },

    async getAllNodes(containerId) {
      return leaves(getContainer(containerId).root)
    },

    async getNodePath(containerId, nodeId) {
      const path = findpath(getContainer(containerId).root, nodeId)
      return path ? path.join(".") : undefined
    },

    async findNodes(containerId, pred) {
      const root = getContainer(containerId).root
      const out: PaneNode<Meta>[] = []
      walk(root, (n) => {
        if (!pred(n)) return
        out.push(n)
      })
      return out
    },

    async getRenderTree(containerId) {
      return getRenderTree(containerId)
    },

    onLayoutChange(containerId, fn) {
      const set = listeners.get(containerId) ?? new Set()
      set.add(fn)
      listeners.set(containerId, set)
      fn(getRenderTree(containerId))
      return () => {
        const next = listeners.get(containerId)
        if (!next) return
        next.delete(fn)
        if (next.size !== 0) return
        listeners.delete(containerId)
      }
    },

    async navigate(containerId, fromNodeId, dir) {
      const next = ops.navigate(containerId, fromNodeId, dir)
      return next
    },

    async applyOperations(items) {
      const ids = new Set(items.flatMap(changed))
      items.forEach(apply)
      ids.forEach(emit)
    },

    async getLayout() {
      const out: Record<string, Container<Meta>> = {}
      containers.forEach((c, id) => {
        out[id] = { ...c, children: [...c.children] }
      })
      return {
        containers: out,
        activeContainerId: active.id,
        focusedNodeId: Object.fromEntries([...focus.entries()]),
      }
    },

    async setLayout(layout) {
      containers.clear()
      Object.entries(layout.containers).forEach(([id, c]) => {
        containers.set(id, { ...c, id, children: [...(c.children ?? [])] })
      })
      focus.clear()
      Object.entries(layout.focusedNodeId ?? {}).forEach(([id, n]) => focus.set(id, n))
      active.id = layout.activeContainerId
      containers.forEach((_, id) => emit(id))
    },
  }

  return api
}

const ctx = createSimpleContext<PaneManager<unknown>, { layout?: Layout<unknown> }>({
  name: "PaneManager",
  init: (props) => createPaneManager(props.layout),
})

export const PaneManagerProvider = ctx.provider
export const usePaneManager = <Meta,>() => ctx.use() as PaneManager<Meta>
