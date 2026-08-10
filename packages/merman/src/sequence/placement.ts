import { diagramTextWidth } from "../core/text.js"
import { normalizeSequenceMinParticipantGap, SEQUENCE_LIFELINE_FADE_STEPS } from "./options.js"
import type {
  SequenceDiagram,
  SequenceDiagramRenderOptions,
  SequenceFragment,
  SequenceMessage,
  SequenceNote,
  SequenceParticipant,
  SequenceParticipantGroup,
  SequenceStep,
} from "./types.js"

const NOTE_HORIZONTAL_PADDING = 2
const GROUP_HORIZONTAL_PADDING = 2
const FRAGMENT_HORIZONTAL_OVERHANG = 3

export interface SequenceHorizontalBounds {
  leftX: number
  rightX: number
}

export interface SequenceParticipantPlacement {
  participant: SequenceParticipant
  centerX: number
  headerLeftX: number
  headerRightX: number
  labelLines: string[]
}

export interface SequenceGroupPlacement {
  group: SequenceParticipantGroup
  labelText: string
  leftX: number
  rightX: number
}

export interface SequenceWallPlacement {
  bounds: SequenceHorizontalBounds
  startY: number
  endY: number
}

export interface SequenceActivationPlacement {
  participant: string
  centerX: number
  startY: number
  endY: number
  depth: number
}

export type SequenceStepPlacement =
  | { type: "note"; note: SequenceNote; textLines: string[]; textX: number; textY: number }
  | {
      type: "fragment"
      fragment: SequenceFragment
      labelText: string
      bounds: SequenceHorizontalBounds
      y: number
      wallsBefore?: SequenceWallPlacement
    }
  | {
      type: "message"
      message: SequenceMessage
      labelLines: string[]
      labelX: number
      labelY: number
      arrowY: number
      fromX: number
      toX: number
      leftX: number
      rightX: number
      headX: number
      direction: 1 | -1
      inlineLabel?: string
    }
  | {
      type: "selfMessage"
      message: SequenceMessage
      labelLines: string[]
      centerX: number
      rightX: number
      topY: number
      bottomY: number
    }

export interface SequencePlacementPlan {
  width: number
  height: number
  rows: {
    participantHeaderTopY: number
    participantHeaderY: number
    participantRuleY: number
    lifelineStartY: number
    lifelineEndY: number
  }
  participants: SequenceParticipantPlacement[]
  groups: SequenceGroupPlacement[]
  activations: SequenceActivationPlacement[]
  steps: SequenceStepPlacement[]
}

interface SequenceGroupRange {
  group: SequenceParticipantGroup
  startIndex: number
  endIndex: number
}

interface PendingFragmentFrame {
  startIndex: number
  bounds: SequenceHorizontalBounds
}

interface ActiveFragmentFrame {
  bounds: SequenceHorizontalBounds
  boundaryY: number
}

function visualLength(value: string): number {
  return diagramTextWidth(value)
}

function centeredStart(center: number, text: string): number {
  return center - Math.floor(visualLength(text) / 2)
}

function mermaidLabelLines(label: string): string[] {
  const lines = label.split(/(?:<br\s*\/?\s*>|\\n)/i).map((line) => line.trimEnd())
  return lines.length > 0 ? lines : [""]
}

function noteLabelLines(label: string): string[] {
  const lines = mermaidLabelLines(label)
  const width = labelLinesWidth(lines)
  const padding = " ".repeat(NOTE_HORIZONTAL_PADDING)
  return lines.map((line) => `${padding}${line}${" ".repeat(width - visualLength(line))}${padding}`)
}

function messageLabelText(message: SequenceMessage): string {
  return message.number === undefined ? message.label : `${message.number}. ${message.label}`
}

function participantHeaderWidth(label: string, compact: boolean): number {
  const width = labelLinesWidth(mermaidLabelLines(label))
  return compact ? width : Math.max(3, width)
}

function fragmentLabelText(fragment: SequenceFragment): string {
  if (fragment.kind === "end") return ""
  const prefix = fragment.kind === "loop" ? "↻ loop" : fragment.kind
  return ` ${prefix}: ${fragment.label} `
}

function messageLabelLines(label: string): string[] {
  return mermaidLabelLines(label)
}

function labelLinesWidth(lines: string[]): number {
  return lines.reduce((max, line) => Math.max(max, visualLength(line)), 0)
}

function messageWidth(message: SequenceMessage): number {
  return labelLinesWidth(messageLabelLines(messageLabelText(message)))
}

function selfMessageLoopWidthForLines(labelLines: string[]): number {
  return Math.max(10, labelLinesWidth(labelLines) + 4)
}

function selfMessageLoopWidth(message: SequenceMessage): number {
  return selfMessageLoopWidthForLines(messageLabelLines(messageLabelText(message)))
}

function arrowHeadX(toX: number, direction: 1 | -1, head: SequenceMessage["head"]): number {
  return head === undefined ? toX : toX - direction
}

function inlineMessageLabel(
  message: SequenceMessage,
  labelLines: string[],
  fromX: number,
  toX: number,
  compact: boolean,
): string | undefined {
  if (!compact || message.from === message.to || labelLines.length !== 1) return undefined
  const label = ` ${labelLines[0]} `
  return visualLength(label) <= Math.abs(toX - fromX) - 3 ? label : undefined
}

function getStepHeight(
  step: SequenceStep,
  centers: number[],
  participantIndexes: Map<string, number>,
  compact: boolean,
): number {
  if (step.type === "note") return noteLabelLines(step.note.label).length + 2
  if (step.type === "activation") return 0
  if (step.type === "fragment") return 2
  const labelLines = messageLabelLines(messageLabelText(step.message))
  const fromX = centers[participantIndexes.get(step.message.from) ?? -1]
  const toX = centers[participantIndexes.get(step.message.to) ?? -1]
  if (fromX !== undefined && toX !== undefined && inlineMessageLabel(step.message, labelLines, fromX, toX, compact)) {
    return 2
  }
  return labelLines.length + (step.message.from === step.message.to ? 3 : 2)
}

function createParticipantIndexMap(diagram: SequenceDiagram): Map<string, number> {
  return new Map(diagram.participants.map((participant, index) => [participant.id, index]))
}

function getParticipantIndexes(participantIndexes: Map<string, number>, participantIds: string[]): number[] {
  return participantIds.map((id) => participantIndexes.get(id) ?? -1).filter((index) => index >= 0)
}

function groupLabelText(group: SequenceParticipantGroup): string {
  return group.label ? ` ${group.label} ` : ""
}

function getGroupRanges(diagram: SequenceDiagram, participantIndexes: Map<string, number>): SequenceGroupRange[] {
  return diagram.groups.flatMap((group) => {
    const indexes = getParticipantIndexes(participantIndexes, group.participantIds)
    return indexes.length === 0 ? [] : [{ group, startIndex: Math.min(...indexes), endIndex: Math.max(...indexes) }]
  })
}

function getStepParticipantIndexes(step: SequenceStep, participantIndexes: Map<string, number>): number[] {
  if (step.type === "message") {
    return getParticipantIndexes(participantIndexes, [step.message.from, step.message.to])
  }
  if (step.type === "note") return getParticipantIndexes(participantIndexes, step.note.over)
  return []
}

function getStepContentBounds(
  step: SequenceStep,
  centers: number[],
  participantIndexes: Map<string, number>,
): SequenceHorizontalBounds | undefined {
  if (step.type === "message") {
    const fromIndex = participantIndexes.get(step.message.from) ?? -1
    const toIndex = participantIndexes.get(step.message.to) ?? -1
    if (fromIndex < 0 || toIndex < 0) return undefined
    const fromX = centers[fromIndex]!
    const toX = centers[toIndex]!
    if (fromIndex === toIndex) return { leftX: fromX, rightX: fromX + selfMessageLoopWidth(step.message) }
    const leftX = Math.min(fromX, toX)
    const rightX = Math.max(fromX, toX)
    const labelWidth = messageWidth(step.message)
    const labelLeftX = leftX + 2
    return { leftX: Math.min(leftX, labelLeftX), rightX: Math.max(rightX, labelLeftX + labelWidth - 1) }
  }
  if (step.type !== "note") return undefined
  const indexes = getParticipantIndexes(participantIndexes, step.note.over)
  if (indexes.length === 0) return undefined
  const centerX = Math.floor((centers[Math.min(...indexes)]! + centers[Math.max(...indexes)]!) / 2)
  const textLines = noteLabelLines(step.note.label)
  const width = labelLinesWidth(textLines)
  const leftX =
    step.note.position === "left"
      ? centerX - width - 2
      : step.note.position === "right"
        ? centerX + 2
        : centerX - Math.floor(width / 2)
  return { leftX, rightX: leftX + width - 1 }
}

function rangeContainsIndexes(range: SequenceGroupRange, indexes: readonly number[]): boolean {
  return indexes.length > 0 && indexes.every((index) => index >= range.startIndex && index <= range.endIndex)
}

function resolveGroupBounds(
  diagram: SequenceDiagram,
  centers: number[],
  participantIndexes: Map<string, number>,
  groupRanges: SequenceGroupRange[],
  compact: boolean,
): SequenceGroupPlacement[] {
  return groupRanges.map((range) => {
    let contentLeftX = centers[range.startIndex]!
    let contentRightX = centers[range.endIndex]!
    for (let i = range.startIndex; i <= range.endIndex; i++) {
      const headerWidth = participantHeaderWidth(diagram.participants[i]!.label, compact)
      const headerStartX = centers[i]! - Math.floor(headerWidth / 2)
      contentLeftX = Math.min(contentLeftX, headerStartX)
      contentRightX = Math.max(contentRightX, headerStartX + headerWidth - 1)
    }
    for (const step of diagram.steps) {
      const indexes = getStepParticipantIndexes(step, participantIndexes)
      if (!rangeContainsIndexes(range, indexes)) continue
      const bounds = getStepContentBounds(step, centers, participantIndexes)
      if (bounds) {
        contentLeftX = Math.min(contentLeftX, bounds.leftX)
        contentRightX = Math.max(contentRightX, bounds.rightX)
      }
    }
    const labelText = groupLabelText(range.group)
    let leftX = contentLeftX - GROUP_HORIZONTAL_PADDING
    let rightX = contentRightX + GROUP_HORIZONTAL_PADDING
    const extraWidth = Math.max(0, visualLength(labelText) + 4 - (rightX - leftX + 1))
    leftX -= Math.floor(extraWidth / 2)
    rightX += Math.ceil(extraWidth / 2)
    return { group: range.group, labelText, leftX, rightX }
  })
}

function expandHorizontalBounds(bounds: SequenceHorizontalBounds, leftX: number, rightX: number): void {
  bounds.leftX = Math.min(bounds.leftX, leftX)
  bounds.rightX = Math.max(bounds.rightX, rightX)
}

function getDiagramContentBounds(
  diagram: SequenceDiagram,
  centers: number[],
  participantIndexes: Map<string, number>,
  compact: boolean,
): SequenceHorizontalBounds {
  const bounds = { leftX: 0, rightX: 0 }
  for (let i = 0; i < diagram.participants.length; i++) {
    const headerWidth = participantHeaderWidth(diagram.participants[i]!.label, compact)
    const labelStartX = centers[i]! - Math.floor(headerWidth / 2)
    expandHorizontalBounds(bounds, labelStartX, labelStartX + headerWidth - 1)
  }
  for (const step of diagram.steps) {
    const content = getStepContentBounds(step, centers, participantIndexes)
    if (content) expandHorizontalBounds(bounds, content.leftX, content.rightX)
  }
  return bounds
}

function getFragmentFrameBounds(
  centers: number[],
  fragment: SequenceFragment,
  nestingDepth = 0,
): SequenceHorizontalBounds | undefined {
  const leftParticipantX = centers[0]
  const rightParticipantX = centers[centers.length - 1]
  if (leftParticipantX === undefined || rightParticipantX === undefined) return undefined
  const leftX = leftParticipantX - FRAGMENT_HORIZONTAL_OVERHANG + nestingDepth
  const participantRightX = rightParticipantX + FRAGMENT_HORIZONTAL_OVERHANG - nestingDepth
  return { leftX, rightX: Math.max(participantRightX, leftX + 2 + visualLength(fragmentLabelText(fragment)) + 1) }
}

function getFragmentFrameBoundsByStep(
  centers: number[],
  steps: SequenceStep[],
  participantIndexes: Map<string, number>,
): Map<number, SequenceHorizontalBounds> {
  const boundsByStep = new Map<number, SequenceHorizontalBounds>()
  const activeFrames: PendingFragmentFrame[] = []
  for (const [index, step] of steps.entries()) {
    if (step.type !== "fragment") {
      const content = getStepContentBounds(step, centers, participantIndexes)
      if (content) {
        for (const frame of activeFrames) {
          expandHorizontalBounds(frame.bounds, content.leftX - 1, content.rightX + 1)
        }
      }
      continue
    }
    const bounds = getFragmentFrameBounds(centers, step.fragment, activeFrames.length)
    if (!bounds) continue
    if (step.fragment.kind === "alt" || step.fragment.kind === "loop") {
      activeFrames.push({ startIndex: index, bounds: { ...bounds } })
      continue
    }
    const frame = activeFrames[activeFrames.length - 1]
    if (!frame) continue
    expandHorizontalBounds(frame.bounds, bounds.leftX, bounds.rightX)
    if (step.fragment.kind !== "end") continue
    activeFrames.pop()
    boundsByStep.set(frame.startIndex, frame.bounds)
    const parent = activeFrames[activeFrames.length - 1]
    if (parent) expandHorizontalBounds(parent.bounds, frame.bounds.leftX - 1, frame.bounds.rightX + 1)
  }
  for (const frame of activeFrames) boundsByStep.set(frame.startIndex, frame.bounds)
  return boundsByStep
}

function resolveParticipantCenters(
  diagram: SequenceDiagram,
  participantIndexes: Map<string, number>,
  minParticipantGap: number,
  compact: boolean,
): number[] {
  const gaps = Array.from({ length: Math.max(0, diagram.participants.length - 1) }, (_, index) => {
    const left = diagram.participants[index]!
    const right = diagram.participants[index + 1]!
    return Math.max(
      minParticipantGap,
      Math.ceil(participantHeaderWidth(left.label, compact) / 2) +
        Math.ceil(participantHeaderWidth(right.label, compact) / 2) +
        6,
    )
  })
  for (const message of diagram.messages) {
    const fromIndex = participantIndexes.get(message.from) ?? -1
    const toIndex = participantIndexes.get(message.to) ?? -1
    if (fromIndex === toIndex && fromIndex >= 0 && fromIndex < diagram.participants.length - 1) {
      gaps[fromIndex] = Math.max(
        gaps[fromIndex]!,
        selfMessageLoopWidth(message) +
          Math.ceil(labelLinesWidth(mermaidLabelLines(diagram.participants[fromIndex + 1]!.label)) / 2) +
          2,
      )
      continue
    }
    if (fromIndex < 0 || toIndex < 0 || Math.abs(fromIndex - toIndex) !== 1) continue
    const gapIndex = Math.min(fromIndex, toIndex)
    gaps[gapIndex] = Math.max(gaps[gapIndex]!, messageWidth(message) + 6)
  }
  for (const step of diagram.steps) {
    if (step.type !== "note") continue
    const indexes = getParticipantIndexes(participantIndexes, step.note.over)
    if (indexes.length === 1 && step.note.position && step.note.position !== "over") {
      const participantIndex = indexes[0]!
      const gapIndex = step.note.position === "left" ? participantIndex - 1 : participantIndex
      if (gapIndex >= 0 && gapIndex < gaps.length) {
        gaps[gapIndex] = Math.max(gaps[gapIndex]!, labelLinesWidth(noteLabelLines(step.note.label)) + 4)
      }
      continue
    }
    if (indexes.length !== 2 || Math.abs(indexes[0]! - indexes[1]!) !== 1) continue
    const gapIndex = Math.min(indexes[0]!, indexes[1]!)
    gaps[gapIndex] = Math.max(gaps[gapIndex]!, labelLinesWidth(noteLabelLines(step.note.label)) + 4)
  }
  const centers = [Math.max(1, Math.floor(participantHeaderWidth(diagram.participants[0]?.label ?? "", compact) / 2))]
  for (let i = 1; i < diagram.participants.length; i++) centers[i] = centers[i - 1]! + gaps[i - 1]!
  return centers
}

function separateExpandedGroupsFromExternalParticipants(
  diagram: SequenceDiagram,
  centers: number[],
  participantIndexes: Map<string, number>,
  ranges: SequenceGroupRange[],
  compact: boolean,
): number[] {
  const adjusted = [...centers]
  for (let boundary = 0; boundary < adjusted.length - 1; boundary++) {
    const groups = resolveGroupBounds(diagram, adjusted, participantIndexes, ranges, compact)
    const leftWidth = participantHeaderWidth(diagram.participants[boundary]!.label, compact)
    const rightWidth = participantHeaderWidth(diagram.participants[boundary + 1]!.label, compact)
    let leftRight = adjusted[boundary]! - Math.floor(leftWidth / 2) + leftWidth - 1
    let rightLeft = adjusted[boundary + 1]! - Math.floor(rightWidth / 2)
    let bordersGroup = false

    for (const [index, range] of ranges.entries()) {
      if (range.endIndex === boundary) {
        leftRight = Math.max(leftRight, groups[index]!.rightX)
        bordersGroup = true
      }
      if (range.startIndex === boundary + 1) {
        rightLeft = Math.min(rightLeft, groups[index]!.leftX)
        bordersGroup = true
      }
    }

    if (!bordersGroup) continue
    const shift = leftRight + GROUP_HORIZONTAL_PADDING + 1 - rightLeft
    if (shift <= 0) continue
    for (let participantIndex = boundary + 1; participantIndex < adjusted.length; participantIndex++) {
      adjusted[participantIndex]! += shift
    }
  }
  return adjusted
}

export function createSequencePlacementPlan(
  diagram: SequenceDiagram,
  options: Pick<SequenceDiagramRenderOptions, "compact" | "minParticipantGap"> = {},
): SequencePlacementPlan {
  if (diagram.participants.length === 0) {
    return {
      width: 0,
      height: 0,
      rows: {
        participantHeaderTopY: 0,
        participantHeaderY: 0,
        participantRuleY: 0,
        lifelineStartY: 0,
        lifelineEndY: 0,
      },
      participants: [],
      groups: [],
      activations: [],
      steps: [],
    }
  }
  const indexes = createParticipantIndexMap(diagram)
  const compact = options.compact ?? false
  let centers = resolveParticipantCenters(
    diagram,
    indexes,
    normalizeSequenceMinParticipantGap(options.minParticipantGap),
    compact,
  )
  const ranges = getGroupRanges(diagram, indexes)
  centers = separateExpandedGroupsFromExternalParticipants(diagram, centers, indexes, ranges, compact)
  let groups = resolveGroupBounds(diagram, centers, indexes, ranges, compact)
  let contentBounds = getDiagramContentBounds(diagram, centers, indexes, compact)
  let frameBounds = getFragmentFrameBoundsByStep(centers, diagram.steps, indexes)
  const fragmentBounds = (): SequenceHorizontalBounds => {
    const result = { leftX: 0, rightX: 0 }
    for (const bounds of frameBounds.values()) expandHorizontalBounds(result, bounds.leftX, bounds.rightX)
    return result
  }
  let fragments = fragmentBounds()
  const leftOverflow = Math.min(
    groups.reduce((left, group) => Math.min(left, group.leftX), 0),
    contentBounds.leftX,
    fragments.leftX,
    0,
  )
  if (leftOverflow < 0) {
    centers = centers.map((center) => center - leftOverflow)
    groups = resolveGroupBounds(diagram, centers, indexes, ranges, compact)
    contentBounds = getDiagramContentBounds(diagram, centers, indexes, compact)
    frameBounds = getFragmentFrameBoundsByStep(centers, diagram.steps, indexes)
    fragments = fragmentBounds()
  }
  const hasGroups = groups.length > 0
  const participantLabelHeight = Math.max(
    1,
    ...diagram.participants.map((participant) => mermaidLabelLines(participant.label).length),
  )
  const participantHeaderTopY = hasGroups ? 1 : 0
  const participantHeaderY = participantHeaderTopY
  const participantRuleY = participantHeaderTopY + (compact ? participantLabelHeight - 1 : participantLabelHeight)
  const lifelineStartY = participantRuleY + 1
  const stepStartY = lifelineStartY + 1
  const width = Math.max(contentBounds.rightX + 1, ...groups.map((group) => group.rightX + 1), fragments.rightX + 1)
  const baseHeight =
    stepStartY +
    diagram.steps.reduce((total, step) => total + getStepHeight(step, centers, indexes, compact), 0) +
    SEQUENCE_LIFELINE_FADE_STEPS.length -
    1
  const height = hasGroups ? Math.max(5, baseHeight + 1) : Math.max(3, baseHeight)
  const lifelineEndY = hasGroups ? height - 2 : height - 1
  const participants = diagram.participants.map((participant, index) => {
    const centerX = centers[index]!
    const width = participantHeaderWidth(participant.label, compact)
    const headerLeftX = centerX - Math.floor(width / 2)
    const labelLines = mermaidLabelLines(participant.label)
    return {
      participant,
      centerX,
      headerLeftX,
      headerRightX: headerLeftX + width - 1,
      labelLines,
    }
  })
  const steps: SequenceStepPlacement[] = []
  const activations: SequenceActivationPlacement[] = []
  const activeByParticipant = new Map<string, Array<{ startY: number; depth: number }>>()
  const lastEventYByParticipant = new Map<string, number>()
  const openActivation = (participant: string, y: number): void => {
    const active = activeByParticipant.get(participant) ?? []
    active.push({ startY: y, depth: active.length })
    activeByParticipant.set(participant, active)
  }
  const closeActivation = (participant: string, y: number): void => {
    const active = activeByParticipant.get(participant)
    const opened = active?.pop()
    const participantIndex = indexes.get(participant)
    if (!opened || participantIndex === undefined) return
    activations.push({
      participant,
      centerX: centers[participantIndex]!,
      startY: opened.startY,
      endY: y,
      depth: opened.depth,
    })
  }
  let stepY = stepStartY
  const activeFrames: ActiveFragmentFrame[] = []
  for (const [stepIndex, step] of diagram.steps.entries()) {
    if (step.type === "activation") {
      const eventY = Math.min(lastEventYByParticipant.get(step.activation.participant) ?? stepY, lifelineEndY)
      if (step.activation.active) openActivation(step.activation.participant, eventY)
      else closeActivation(step.activation.participant, eventY)
      continue
    }
    const stepHeight = getStepHeight(step, centers, indexes, compact)
    if (step.type === "note") {
      const noteIndexes = getParticipantIndexes(indexes, step.note.over)
      if (noteIndexes.length > 0) {
        const centerX = Math.floor((centers[Math.min(...noteIndexes)]! + centers[Math.max(...noteIndexes)]!) / 2)
        const textLines = noteLabelLines(step.note.label)
        const width = labelLinesWidth(textLines)
        const textX =
          step.note.position === "left"
            ? centerX - width - 2
            : step.note.position === "right"
              ? centerX + 2
              : centerX - Math.floor(width / 2)
        steps.push({ type: "note", note: step.note, textLines, textX, textY: stepY + 1 })
      }
      stepY += stepHeight
      continue
    }
    if (step.type === "fragment") {
      let bounds = frameBounds.get(stepIndex) ?? getFragmentFrameBounds(centers, step.fragment)
      let wallsBefore: SequenceWallPlacement | undefined
      if (step.fragment.kind === "alt" || step.fragment.kind === "loop") {
        if (bounds) activeFrames.push({ bounds, boundaryY: stepY })
      } else {
        const frame = activeFrames[activeFrames.length - 1]
        if (frame) {
          bounds = frame.bounds
          wallsBefore = { bounds, startY: frame.boundaryY + 1, endY: stepY - 1 }
          if (step.fragment.kind === "end") activeFrames.pop()
          else frame.boundaryY = stepY
        }
      }
      if (bounds)
        steps.push({
          type: "fragment",
          fragment: step.fragment,
          labelText: fragmentLabelText(step.fragment),
          bounds,
          y: stepY,
          wallsBefore,
        })
      stepY += stepHeight
      continue
    }
    const fromIndex = indexes.get(step.message.from) ?? -1
    const toIndex = indexes.get(step.message.to) ?? -1
    if (fromIndex < 0 || toIndex < 0) continue
    const labelLines = messageLabelLines(messageLabelText(step.message))
    if (fromIndex === toIndex) {
      const centerX = centers[fromIndex]!
      const bottomY = stepY + labelLines.length + 1
      steps.push({
        type: "selfMessage",
        message: step.message,
        labelLines,
        centerX,
        rightX: centerX + selfMessageLoopWidthForLines(labelLines),
        topY: stepY,
        bottomY,
      })
      if (step.message.activate) openActivation(step.message.activate, bottomY)
      if (step.message.deactivate) closeActivation(step.message.deactivate, bottomY)
      lastEventYByParticipant.set(step.message.from, bottomY)
    } else {
      const fromX = centers[fromIndex]!
      const toX = centers[toIndex]!
      const direction: 1 | -1 = toX > fromX ? 1 : -1
      const leftX = Math.min(fromX, toX)
      const rightX = Math.max(fromX, toX)
      const inlineLabel = inlineMessageLabel(step.message, labelLines, fromX, toX, compact)
      const arrowY = inlineLabel ? stepY : stepY + labelLines.length
      const renderedLabelWidth = inlineLabel ? visualLength(inlineLabel) : labelLinesWidth(labelLines)
      const labelX = inlineLabel ? Math.floor((leftX + rightX - renderedLabelWidth) / 2) : leftX + 2
      steps.push({
        type: "message",
        message: step.message,
        labelLines,
        labelX,
        labelY: stepY,
        arrowY,
        fromX,
        toX,
        leftX,
        rightX,
        direction,
        headX: arrowHeadX(toX, direction, step.message.head),
        inlineLabel,
      })
      if (step.message.activate) openActivation(step.message.activate, arrowY)
      if (step.message.deactivate) closeActivation(step.message.deactivate, arrowY)
      lastEventYByParticipant.set(step.message.from, arrowY)
      lastEventYByParticipant.set(step.message.to, arrowY)
    }
    stepY += stepHeight
  }
  for (const [participant, active] of activeByParticipant) {
    while (active.length > 0) closeActivation(participant, lifelineEndY)
  }
  return {
    width,
    height,
    rows: { participantHeaderTopY, participantHeaderY, participantRuleY, lifelineStartY, lifelineEndY },
    participants,
    groups,
    activations,
    steps,
  }
}
