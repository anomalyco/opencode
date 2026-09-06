export * as DecisionTree from "./decision-tree"

import { SessionSchema } from "./schema"

export type DecisionNodeType =
  | "goal"
  | "hypothesis"
  | "action"
  | "verification"
  | "pruned"
  | "survivor"

export interface DecisionTreeNode {
  readonly id: string
  readonly sessionID: SessionSchema.ID
  readonly parentId?: string
  readonly type: DecisionNodeType
  readonly label: string
  readonly step: number
  probability?: number
  status: "active" | "verified" | "refuted" | "pruned" | "branched"
  readonly timestamp: number
  readonly children: string[]
  readonly metadata?: Record<string, unknown>
}

export interface DecisionTreeState {
  readonly sessionID: SessionSchema.ID
  rootId?: string
  readonly nodes: Map<string, DecisionTreeNode>
}

const treeStore = new Map<string, DecisionTreeState>()

const getOrCreateState = (sessionID: SessionSchema.ID): DecisionTreeState => {
  let state = treeStore.get(sessionID)
  if (!state) {
    state = {
      sessionID,
      nodes: new Map(),
    }
    treeStore.set(sessionID, state)
  }
  return state
}

export const setRootGoal = (sessionID: SessionSchema.ID, goal: string): DecisionTreeNode => {
  const state = getOrCreateState(sessionID)
  const id = `node_root_${Date.now()}`
  const node: DecisionTreeNode = {
    id,
    sessionID,
    type: "goal",
    label: goal,
    step: 0,
    status: "active",
    timestamp: Date.now(),
    children: [],
  }
  state.rootId = id
  state.nodes.set(id, node)
  return node
}

export const branchHypotheses = (
  sessionID: SessionSchema.ID,
  parentId: string,
  step: number,
  hypotheses: ReadonlyArray<{ readonly description: string; readonly probability: number }>,
): DecisionTreeNode[] => {
  const state = getOrCreateState(sessionID)
  const parent = state.nodes.get(parentId)
  if (parent) parent.status = "branched"

  const created: DecisionTreeNode[] = []
  for (let i = 0; i < hypotheses.length; i++) {
    const h = hypotheses[i]!
    const id = `node_hyp_${step}_${i}_${Date.now()}`
    const node: DecisionTreeNode = {
      id,
      sessionID,
      parentId,
      type: "hypothesis",
      label: h.description,
      step,
      probability: h.probability,
      status: "active",
      timestamp: Date.now(),
      children: [],
    }
    state.nodes.set(id, node)
    if (parent) parent.children.push(id)
    created.push(node)
  }
  return created
}

export const pruneNode = (
  sessionID: SessionSchema.ID,
  nodeId: string,
  reason: string,
): DecisionTreeNode | undefined => {
  const state = getOrCreateState(sessionID)
  const node = state.nodes.get(nodeId)
  if (!node) return undefined

  node.status = "pruned"
  return node
}

export const verifyNode = (
  sessionID: SessionSchema.ID,
  nodeId: string,
): DecisionTreeNode | undefined => {
  const state = getOrCreateState(sessionID)
  const node = state.nodes.get(nodeId)
  if (!node) return undefined

  node.status = "verified"
  return node
}

export const getNode = (sessionID: SessionSchema.ID, nodeId: string): DecisionTreeNode | undefined => {
  return treeStore.get(sessionID)?.nodes.get(nodeId)
}

export const getDecisionTree = (sessionID: SessionSchema.ID): DecisionTreeState | undefined => {
  return treeStore.get(sessionID)
}

export const renderAsciiTree = (sessionID: SessionSchema.ID): string => {
  const state = treeStore.get(sessionID)
  if (!state || !state.rootId) return "(Empty decision tree)"

  const lines: string[] = []

  const walk = (nodeId: string, prefix: string, isLast: boolean) => {
    const node = state.nodes.get(nodeId)
    if (!node) return

    const marker = isLast ? "└── " : "├── "
    const statusTag =
      node.status === "verified"
        ? "[✓ verified]"
        : node.status === "pruned" || node.status === "refuted"
          ? "[✗ pruned]"
          : node.status === "branched"
            ? "[⑂ branched]"
            : "[• active]"

    const prob = node.probability !== undefined ? ` (${Math.round(node.probability * 100)}%)` : ""
    lines.push(`${prefix}${marker}${statusTag} ${node.label}${prob}`)

    const nextPrefix = prefix + (isLast ? "    " : "│   ")
    for (let i = 0; i < node.children.length; i++) {
      const childId = node.children[i]!
      walk(childId, nextPrefix, i === node.children.length - 1)
    }
  }

  const root = state.nodes.get(state.rootId)
  if (root) {
    lines.push(`[Goal]: ${root.label}`)
    for (let i = 0; i < root.children.length; i++) {
      walk(root.children[i]!, "", i === root.children.length - 1)
    }
  }

  return lines.join("\n")
}
