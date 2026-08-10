import {
  clampPoint,
  centeredSpanStart,
  insetSpan,
  midpoint,
  point,
  pointOnSegment,
  segmentBetween,
  segmentSpan,
  shiftPoint,
  spanCapacity,
  type DiagramSegment,
} from "../core/geometry.js"
import { splitDiagramLines } from "../core/text.js"
import type { FlowchartPoint } from "./types.js"

const LABEL_BUS_CLEARANCE = 3
const LABEL_NODE_CLEARANCE = 2
const LABEL_LINE_CLEARANCE = 2
const LABEL_PADDING = 1

export interface FlowchartEdgeLabelLayout {
  lines: string[]
  point: FlowchartPoint
  width: number
  height: number
}

export function flowchartLabelText(label: string): string {
  return `${" ".repeat(LABEL_PADDING)}${label}${" ".repeat(LABEL_PADDING)}`
}

export function flowchartLabelWidth(label: string, measure: (text: string) => number): number {
  return Math.max(...splitDiagramLines(label).map((line) => measure(line) + LABEL_PADDING * 2))
}

function minimumInlineLabelLength(labelWidth: number): number {
  return labelWidth + LABEL_LINE_CLEARANCE * 2 - 1
}

export function flowchartHorizontalLabelRankGap(labelWidth: number): number {
  return minimumInlineLabelLength(labelWidth) + LABEL_BUS_CLEARANCE + 1
}

export function flowchartVerticalBranchLabelGap(labelWidth: number): number {
  return minimumInlineLabelLength(labelWidth) + LABEL_BUS_CLEARANCE + LABEL_NODE_CLEARANCE
}

function inlineLabelSlot(segment: DiagramSegment, labelWidth: number): { x: number; fits: boolean } {
  const slot = insetSpan(segmentSpan(segment), LABEL_LINE_CLEARANCE)
  return { x: centeredSpanStart(slot, labelWidth), fits: spanCapacity(slot) >= labelWidth }
}

function segmentLabelPoint(segment: DiagramSegment, labelWidth: number, labelHeight: number): FlowchartPoint {
  if (segment.axis === "x") {
    const slot = inlineLabelSlot(segment, labelWidth)
    if (labelHeight === 1 && slot.fits) return point(slot.x, segment.from.y)

    if (labelHeight > 1) {
      return shiftPoint(point(slot.x, segment.from.y), "up", labelHeight)
    }

    return clampPoint(shiftPoint(shiftPoint(segment.from, segment.direction, LABEL_LINE_CLEARANCE), "up", labelHeight))
  }

  const center = shiftPoint(pointOnSegment(segment, midpoint(segmentSpan(segment))), "right")
  return clampPoint(shiftPoint(center, "up", Math.floor((labelHeight - 1) / 2)))
}

function bestLabelSegment(points: readonly FlowchartPoint[], labelWidth: number): DiagramSegment | undefined {
  let roomyHorizontal: DiagramSegment | undefined
  let verticalBus: DiagramSegment | undefined
  let longest: DiagramSegment | undefined

  for (let index = 1; index < points.length; index++) {
    const segment = segmentBetween(points[index - 1]!, points[index]!)
    if (!segment) continue
    if (!roomyHorizontal && segment.axis === "x" && inlineLabelSlot(segment, labelWidth).fits) roomyHorizontal = segment
    if (!verticalBus && segment.axis === "y") verticalBus = segment
    if (!longest || segment.length > longest.length) longest = segment
  }

  return roomyHorizontal ?? verticalBus ?? longest
}

function flowchartLabelPoint(
  points: readonly FlowchartPoint[],
  labelWidth: number,
  labelHeight: number,
): FlowchartPoint {
  const segment = bestLabelSegment(points, labelWidth)
  return segment ? segmentLabelPoint(segment, labelWidth, labelHeight) : (points[0] ?? point(0, 0))
}

export function flowchartEdgeLabelLayout(
  points: readonly FlowchartPoint[],
  label: string,
  measure: (text: string) => number,
): FlowchartEdgeLabelLayout {
  const lines = splitDiagramLines(label).map(flowchartLabelText)
  const width = flowchartLabelWidth(label, measure)
  const height = lines.length
  return { lines, point: flowchartLabelPoint(points, width, height), width, height }
}
