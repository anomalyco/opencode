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
}

export type GanttCellStyle = "title" | "axis" | "section" | GanttTaskState
