import type { Program } from "acorn"
import type { AstNode } from "./model.js"

/** A stable reference to one AST node: its source and its index in a pre-order walk of that source's tree. */
export type NodeId = { readonly source: string; readonly index: number }

/** One parsed program text with every node numbered in pre-order, so a node can be named and found again. */
export class Source {
  /** Nodes by pre-order index. */
  readonly nodes: ReadonlyArray<AstNode>

  constructor(
    readonly id: string,
    readonly code: string,
    readonly program: Program,
  ) {
    const nodes: Array<AstNode> = []
    number(program, this, nodes)
    this.nodes = nodes
  }

  /** The node `id` names, when it belongs to this source. */
  node(id: NodeId): AstNode | undefined {
    return id.source === this.id ? this.nodes[id.index] : undefined
  }
}

const numbering = new WeakMap<AstNode, { readonly source: Source; readonly index: number }>()

/** The id of a node from a numbered source; nodes built outside one (none today) have none. */
export const nodeId = (node: AstNode): NodeId | undefined => {
  const entry = numbering.get(node)
  return entry === undefined ? undefined : { source: entry.source.id, index: entry.index }
}

/** The source a numbered node belongs to. */
export const sourceOf = (node: AstNode): Source | undefined => numbering.get(node)?.source

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof (value as { readonly type?: unknown }).type === "string"

// Acorn creates node fields in a fixed order, so walking own keys in order gives the same numbering on every parse.
const number = (root: AstNode, source: Source, nodes: Array<AstNode>): void => {
  const pending = [root]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    numbering.set(node, { source, index: nodes.length })
    nodes.push(node)
    const children: Array<AstNode> = []
    for (const key in node) {
      if (key === "loc") continue
      const child: unknown = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(child)) children.push(...child.filter(isNode))
      else if (isNode(child)) children.push(child)
    }
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!)
  }
}

/** Whether `node` is the prelude's: it is parsed without locations, so a failure there is located at the program's call. */
export const inPrelude = (node: AstNode): boolean => node.loc === undefined || node.loc === null
