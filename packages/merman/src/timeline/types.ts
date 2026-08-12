export type TimelineDirection = "TD" | "LR"

export interface TimelineSection {
  label: string
}

export interface TimelinePeriod {
  period: string
  events: string[]
}

export type TimelineEntry = { type: "section"; section: TimelineSection } | { type: "period"; period: TimelinePeriod }

export interface TimelineDiagram {
  direction: TimelineDirection
  title?: string
  sections: TimelineSection[]
  periods: TimelinePeriod[]
  entries: TimelineEntry[]
}

export interface TimelineDiagramRenderOptions {
  /** Parsed for Mermaid compatibility. Timeline diagrams always use a vertical terminal layout. */
  direction?: TimelineDirection
}

export type TimelineCellStyle = "title" | "section" | "period" | "spine" | "event"
