export type GanttTaskState = "task" | "active" | "critical" | "done" | "milestone"

export interface GanttSection {
  label: string
}

export interface GanttTask {
  label: string
  id?: string
  section?: GanttSection
  start: number
  end: number
  state: GanttTaskState
}

export type GanttEntry = { type: "section"; section: GanttSection } | { type: "task"; task: GanttTask }

export interface GanttDiagram {
  title?: string
  dateFormat: string
  axisFormat: string
  tasks: GanttTask[]
  entries: GanttEntry[]
}

export interface GanttDiagramRenderOptions {
  layoutMaxWidth?: number
  style?: GanttRenderStyle
  track?: "dots" | "line"
  endpoints?: "plain" | "points"
  line?: GanttLineStyle
  labels?: GanttLabelLayout
  sections?: "compact" | "spaced"
  trackTone?: GanttTrackTone
}

export type GanttRenderStyle = "rail" | "block" | "capsule" | "points" | "track"
export type GanttLineStyle = "heavy" | "thin" | "double" | "dashed"
export type GanttLabelLayout = "right" | "left" | "tree"
export type GanttTrackTone = "medium" | "dim" | "faint"

export type GanttBaseCellStyle = "title" | "axis" | "section" | GanttTaskState
export type GanttTrackCellStyle = "trackMedium" | "trackDim" | "trackFaint"
export type GanttCellStyle = GanttBaseCellStyle | GanttTrackCellStyle
