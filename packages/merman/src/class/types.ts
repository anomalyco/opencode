import type { FlowchartDirection } from "../flowchart/types.js"

export type ClassRelationMarker = "inheritance" | "composition" | "aggregation" | "arrow"

export interface ClassNode {
  id: string
  label: string
  annotations: string[]
  attributes: string[]
  methods: string[]
}

export interface ClassRelation {
  from: string
  to: string
  label: string
  fromMarker?: ClassRelationMarker
  toMarker?: ClassRelationMarker
  fromCardinality?: string
  toCardinality?: string
  dashed: boolean
}

export interface ClassNamespace {
  id: string
  classIds: string[]
}

export interface ClassDiagram {
  direction: FlowchartDirection
  classes: ClassNode[]
  relations: ClassRelation[]
  namespaces: ClassNamespace[]
}

export interface ClassDiagramRenderOptions {
  compact?: boolean
  layoutMaxWidth?: number
}

export type ClassCellStyle =
  | "classTitle"
  | "classText"
  | "classBorder"
  | "annotation"
  | "edge"
  | "label"
  | "namespace"
  | "namespaceLabel"
