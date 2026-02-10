export type PaneDir = "h" | "v"

export type Pane = { t: "leaf"; id: string } | { t: "split"; dir: PaneDir; a: Pane; b: Pane; size: number }

export type TerminalTabState = {
  pane?: Pane
  focus?: string
  zoom?: string
}

export type TerminalTabAction =
  | { type: "ensure"; id: string }
  | { type: "set_focus"; id: string }
  | { type: "set_zoom"; id?: string }
  | { type: "focus"; id: string }
  | { type: "zoom"; id: string }
  | { type: "split"; at: string; id: string; dir: PaneDir }
  | { type: "close"; id: string }
  | { type: "detach"; id: string }
  | { type: "resize"; path: string; size: number }
  | { type: "swap"; a: string; b: string }

const leaf = (id: string): Pane => ({ t: "leaf", id })

export const paneList = (node: Pane | undefined): string[] => {
  if (!node) return []
  if (node.t === "leaf") return [node.id]
  return [...paneList(node.a), ...paneList(node.b)]
}

export const paneIncludes = (node: Pane | undefined, id: string): boolean => {
  if (!node) return false
  if (node.t === "leaf") return node.id === id
  if (paneIncludes(node.a, id)) return true
  return paneIncludes(node.b, id)
}

const paneReplace = (node: Pane, id: string, next: Pane): Pane => {
  if (node.t === "leaf") return node.id === id ? next : node
  const a = paneReplace(node.a, id, next)
  const b = paneReplace(node.b, id, next)
  if (a === node.a && b === node.b) return node
  return { ...node, a, b }
}

const paneRemove = (node: Pane, id: string): Pane | undefined => {
  if (node.t === "leaf") return node.id === id ? undefined : node

  const a = paneRemove(node.a, id)
  const b = paneRemove(node.b, id)

  if (!a && !b) return undefined
  if (!a) return b
  if (!b) return a
  if (a === node.a && b === node.b) return node
  return { ...node, a, b }
}

const paneResize = (node: Pane, path: string, size: number): Pane => {
  if (node.t === "leaf") return node
  if (!path) return { ...node, size: Math.max(0.1, Math.min(0.9, size)) }
  const head = path[0]
  const rest = path.slice(1)
  if (head === "a") {
    const a = paneResize(node.a, rest, size)
    if (a === node.a) return node
    return { ...node, a }
  }
  const b = paneResize(node.b, rest, size)
  if (b === node.b) return node
  return { ...node, b }
}

export const paneFindPath = (node: Pane | undefined, id: string): string | undefined => {
  if (!node) return
  if (node.t === "leaf") return node.id === id ? "" : undefined
  const a = paneFindPath(node.a, id)
  if (a !== undefined) return "a" + a
  const b = paneFindPath(node.b, id)
  if (b !== undefined) return "b" + b
  return
}

export const reduceTerminalTab = (state: TerminalTabState, action: TerminalTabAction): TerminalTabState => {
  if (action.type === "ensure") {
    if (state.pane) return state
    return { ...state, pane: leaf(action.id), focus: action.id }
  }

  if (action.type === "set_focus") {
    if (state.focus === action.id) return state
    return { ...state, focus: action.id }
  }

  if (action.type === "set_zoom") {
    if (state.zoom === action.id) return state
    return { ...state, zoom: action.id }
  }

  if (action.type === "focus") {
    if (state.focus === action.id && state.zoom === undefined) return state
    return { ...state, focus: action.id, zoom: undefined }
  }

  if (action.type === "zoom") {
    const next = state.zoom === action.id ? undefined : action.id
    if (state.zoom === next) return state
    return { ...state, zoom: next }
  }

  if (action.type === "split") {
    if (!state.pane) return { ...state, pane: { t: "split", dir: action.dir, a: leaf(action.at), b: leaf(action.id), size: 0.5 }, focus: action.id }
    if (!paneIncludes(state.pane, action.at)) {
      const ids = paneList(state.pane)
      const first = ids[0]
      if (!first) return state
      return {
        ...state,
        pane: paneReplace(state.pane, first, { t: "split", dir: action.dir, a: leaf(first), b: leaf(action.id), size: 0.5 }),
        focus: action.id,
      }
    }
    return {
      ...state,
      pane: paneReplace(state.pane, action.at, { t: "split", dir: action.dir, a: leaf(action.at), b: leaf(action.id), size: 0.5 }),
      focus: action.id,
    }
  }

  if (action.type === "close" || action.type === "detach") {
    if (!state.pane) return state
    const pane = paneRemove(state.pane, action.id)
    const ids = paneList(pane)
    const focus = state.focus === action.id ? ids[0] : state.focus
    const zoom = state.zoom === action.id ? undefined : state.zoom
    return { ...state, pane, focus, zoom }
  }

  if (action.type === "resize") {
    if (!state.pane || state.pane.t === "leaf") return state
    const pane = paneResize(state.pane, action.path, action.size)
    if (pane === state.pane) return state
    return { ...state, pane }
  }

  if (action.type === "swap") {
    if (!state.pane) return state
    if (action.a === action.b) return state
    if (!paneIncludes(state.pane, action.a) || !paneIncludes(state.pane, action.b)) return state
    const pane = ((root: Pane): Pane => {
      const walk = (node: Pane): Pane => {
        if (node.t === "leaf") {
          if (node.id === action.a) return leaf(action.b)
          if (node.id === action.b) return leaf(action.a)
          return node
        }
        const a = walk(node.a)
        const b = walk(node.b)
        if (a === node.a && b === node.b) return node
        return { ...node, a, b }
      }
      return walk(root)
    })(state.pane)

    let focus = state.focus
    if (focus === action.a) focus = action.b
    else if (focus === action.b) focus = action.a

    let zoom = state.zoom
    if (zoom === action.a) zoom = action.b
    else if (zoom === action.b) zoom = action.a

    return { ...state, pane, focus, zoom }
  }

  return state
}
