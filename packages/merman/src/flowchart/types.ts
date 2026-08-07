import type { DiagramBounds, DiagramDirection, DiagramPoint } from "../core/geometry.js"

export type FlowchartDirection = "TB" | "TD" | "BT" | "LR" | "RL"
export type FlowchartNodeShape = "box" | "rounded" | "database" | "decision" | "subroutine"
export type FlowchartEdgeStyle = "thick" | "dashed"

export interface FlowchartNode {
  id: string
  label: string
  shape: FlowchartNodeShape
}

export interface FlowchartEdge {
  from: string
  to: string
  label: string
  style?: FlowchartEdgeStyle
}

export interface FlowchartSubgraph {
  id: string
  label: string
  nodeIds: string[]
  parentId?: string
  direction?: FlowchartDirection
}

export interface FlowchartDiagram {
  direction: FlowchartDirection
  nodes: FlowchartNode[]
  edges: FlowchartEdge[]
  subgraphs?: FlowchartSubgraph[]
}

export interface FlowchartNodeSize {
  width: number
  height: number
  lines: string[]
}

export interface FlowchartNodeBounds extends FlowchartNodeSize, DiagramBounds {
  id: string
}

export interface FlowchartSubgraphBounds extends DiagramBounds {
  id: string
  label: string
  labelSide: "top" | "bottom"
}

export type FlowchartPoint = DiagramPoint

export interface FlowchartEdgeRoute {
  edge: FlowchartEdge
  points: FlowchartPoint[]
}

export interface FlowchartActiveEdgeSelection {
  from: string
  to: string
  index?: number
}

export type FlowchartEdgeDirection = DiagramDirection
