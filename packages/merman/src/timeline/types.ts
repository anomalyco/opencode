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

export type TimelineBaseCellStyle = "title" | "section" | "period" | "spine" | "event"
export type TimelineFadeStep = 1 | 2 | 3
export type TimelineSectionFadeStyle = `sectionFade${TimelineFadeStep}`
export type TimelinePeriodFadeStyle = `periodFade${TimelineFadeStep}`
export type TimelineCellStyle = TimelineBaseCellStyle | TimelineSectionFadeStyle | TimelinePeriodFadeStyle
