import {
  firstMeaningfulMermaidLine,
  meaningfulNumberedMermaidLines,
  stripMermaidQuotes as stripQuotes,
} from "../core/mermaid.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import type {
  SequenceArrowHead,
  SequenceDiagram,
  SequenceMessage,
  SequenceParticipant,
  SequenceParticipantGroup,
  SequenceStep,
} from "./types.js"

const MESSAGE_RE = /^(.+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)([+-]?)\s*(.+?)\s*:\s*(.*)$/
const NOTE_RE = /^note\s+(over|left\s+of|right\s+of)\s+(.+?)\s*:\s*(.*)$/i
const PARTICIPANT_RE = /^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i
const ACTIVATION_RE = /^(activate|deactivate)\s+(.+)$/i
const BOX_RE = /^box(?:\s+(.+))?$/i
const ALT_RE = /^alt\s+(.+)$/i
const ELSE_RE = /^else(?:\s+(.+))?$/i
const LOOP_RE = /^loop\s+(.+)$/i
const AUTONUMBER_RE = /^autonumber(?:\s+(\d+)(?:\s+(\d+))?)?$/i
const UNSUPPORTED_BIDIRECTIONAL_MESSAGE_RE = /<<-{1,2}>>/
const CSS_COLOR_NAMES = new Set([
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "cyan",
  "magenta",
  "silver",
  "gray",
  "grey",
  "maroon",
  "olive",
  "lime",
  "aqua",
  "teal",
  "navy",
  "fuchsia",
  "purple",
  "orange",
  "brightblack",
  "brightred",
  "brightgreen",
  "brightblue",
  "brightyellow",
  "brightcyan",
  "brightmagenta",
  "brightwhite",
])

function arrowHeadForSyntax(arrow: string): SequenceArrowHead | undefined {
  if (arrow.endsWith("x")) return "cross"
  if (arrow.endsWith(")")) return "async"
  if (arrow.endsWith(">") && !arrow.endsWith(">>")) return "open"
  return undefined
}

function isBoxColorToken(value: string): boolean {
  const lowerValue = value.toLowerCase()
  return (
    lowerValue === "transparent" ||
    CSS_COLOR_NAMES.has(lowerValue) ||
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^rgba?\(.+\)$/i.test(value)
  )
}

function splitLeadingBoxToken(value: string): { token: string; rest: string } {
  if (/^rgba?\(/i.test(value)) {
    const closeIndex = value.indexOf(")")
    if (closeIndex >= 0) {
      return { token: value.slice(0, closeIndex + 1), rest: value.slice(closeIndex + 1).trim() }
    }
  }

  const firstSpace = value.search(/\s/)
  return firstSpace < 0
    ? { token: value, rest: "" }
    : { token: value.slice(0, firstSpace), rest: value.slice(firstSpace + 1).trim() }
}

function boxLabelText(value: string | undefined): string {
  const rawLabel = (value ?? "").trim()
  if ((rawLabel.startsWith('"') && rawLabel.endsWith('"')) || (rawLabel.startsWith("'") && rawLabel.endsWith("'"))) {
    return stripQuotes(rawLabel)
  }

  const label = stripQuotes(rawLabel)
  if (!label) return ""
  const { token, rest } = splitLeadingBoxToken(label)
  return isBoxColorToken(token) ? stripQuotes(rest) : label
}

function addParticipantToGroup(group: SequenceParticipantGroup | undefined, participantId: string): void {
  if (!group || group.participantIds.includes(participantId)) return
  group.participantIds.push(participantId)
}

function ensureParticipant(
  participants: SequenceParticipant[],
  id: string,
  label: string = id,
  replaceExistingLabel: boolean = false,
): void {
  const existing = participants.find((participant) => participant.id === id)
  if (existing) {
    if (replaceExistingLabel) existing.label = label
    return
  }
  participants.push({ id, label })
}

export function isMermaidSequenceDiagram(content: string): boolean {
  return firstMeaningfulMermaidLine(content)?.toLowerCase() === "sequencediagram"
}

export function parseMermaidSequenceDiagram(content: string): SequenceDiagram {
  const participants: SequenceParticipant[] = []
  const messages: SequenceMessage[] = []
  const steps: SequenceStep[] = []
  const groups: SequenceParticipantGroup[] = []
  const blockStack: Array<{ kind: "box" | "alt" | "loop"; lineNumber: number; sourceLine: string }> = []
  const groupStack: SequenceParticipantGroup[] = []
  let nextMessageNumber: number | undefined
  let messageNumberIncrement = 1

  for (const source of meaningfulNumberedMermaidLines(content)) {
    const line = source.text
    if (line.toLowerCase() === "sequencediagram") continue
    if (UNSUPPORTED_BIDIRECTIONAL_MESSAGE_RE.test(line)) {
      throw new MermaidSyntaxError("sequence", source.lineNumber, line)
    }

    const autonumberMatch = line.match(AUTONUMBER_RE)
    if (autonumberMatch) {
      nextMessageNumber = Number.parseInt(autonumberMatch[1] ?? "1", 10)
      messageNumberIncrement = Number.parseInt(autonumberMatch[2] ?? "1", 10)
      continue
    }

    const boxMatch = line.match(BOX_RE)
    if (boxMatch) {
      const group: SequenceParticipantGroup = { label: boxLabelText(boxMatch[1]), participantIds: [] }
      groups.push(group)
      groupStack.push(group)
      blockStack.push({ kind: "box", lineNumber: source.lineNumber, sourceLine: line })
      continue
    }

    const participantMatch = line.match(PARTICIPANT_RE)
    if (participantMatch) {
      const id = stripQuotes(participantMatch[1]!)
      ensureParticipant(participants, id, stripQuotes(participantMatch[2] ?? id), true)
      addParticipantToGroup(groupStack[groupStack.length - 1], id)
      continue
    }

    const noteMatch = line.match(NOTE_RE)
    if (noteMatch) {
      const position = noteMatch[1]!.toLowerCase().replace(/\s+of$/, "") as "over" | "left" | "right"
      const over = noteMatch[2]!
        .split(",")
        .map((participant) => stripQuotes(participant))
        .filter((participant) => participant.length > 0)
      for (const participant of over) ensureParticipant(participants, participant)
      steps.push({
        type: "note",
        note: {
          over,
          label: stripQuotes(noteMatch[3]!),
          ...(position === "over" ? {} : { position }),
        },
      })
      continue
    }

    const activationMatch = line.match(ACTIVATION_RE)
    if (activationMatch) {
      const participant = stripQuotes(activationMatch[2]!)
      ensureParticipant(participants, participant)
      steps.push({
        type: "activation",
        activation: { participant, active: activationMatch[1]!.toLowerCase() === "activate" },
      })
      continue
    }

    const altMatch = line.match(ALT_RE)
    if (altMatch) {
      blockStack.push({ kind: "alt", lineNumber: source.lineNumber, sourceLine: line })
      steps.push({ type: "fragment", fragment: { kind: "alt", label: stripQuotes(altMatch[1]!) } })
      continue
    }

    const loopMatch = line.match(LOOP_RE)
    if (loopMatch) {
      blockStack.push({ kind: "loop", lineNumber: source.lineNumber, sourceLine: line })
      steps.push({ type: "fragment", fragment: { kind: "loop", label: stripQuotes(loopMatch[1]!) } })
      continue
    }

    const elseMatch = line.match(ELSE_RE)
    if (elseMatch) {
      if (blockStack[blockStack.length - 1]?.kind !== "alt") {
        throw new MermaidSyntaxError(
          "sequence",
          source.lineNumber,
          line,
          'Unexpected "else" without an open "alt" block',
        )
      }
      steps.push({ type: "fragment", fragment: { kind: "else", label: stripQuotes(elseMatch[1] ?? "") } })
      continue
    }

    if (line.toLowerCase() === "end") {
      const block = blockStack.pop()
      if (!block)
        throw new MermaidSyntaxError("sequence", source.lineNumber, line, 'Unexpected "end" without an open block')
      if (block.kind === "box") {
        groupStack.pop()
        continue
      }
      steps.push({ type: "fragment", fragment: { kind: "end", label: block.kind } })
      continue
    }

    const messageMatch = line.match(MESSAGE_RE)
    if (messageMatch) {
      const from = stripQuotes(messageMatch[1]!)
      const arrow = messageMatch[2]!
      const activationMarker = messageMatch[3]!
      const to = stripQuotes(messageMatch[4]!)
      const message: SequenceMessage = {
        from,
        to,
        label: stripQuotes(messageMatch[5]!),
        style: arrow.startsWith("--") ? "dashed" : "solid",
      }
      const activeGroup = groupStack[groupStack.length - 1]
      ensureParticipant(participants, from)
      ensureParticipant(participants, to)
      addParticipantToGroup(activeGroup, from)
      addParticipantToGroup(activeGroup, to)
      const head = arrowHeadForSyntax(arrow)
      if (head) message.head = head
      if (nextMessageNumber !== undefined) {
        message.number = nextMessageNumber
        nextMessageNumber += messageNumberIncrement
      }
      if (activationMarker === "+") message.activate = to
      else if (activationMarker === "-") message.deactivate = from
      messages.push(message)
      steps.push({ type: "message", message })
      continue
    }

    throw new MermaidSyntaxError("sequence", source.lineNumber, line)
  }

  const unclosedBlock = blockStack[blockStack.length - 1]
  if (unclosedBlock) {
    throw new MermaidSyntaxError(
      "sequence",
      unclosedBlock.lineNumber,
      unclosedBlock.sourceLine,
      `Unclosed ${unclosedBlock.kind} block; expected "end"`,
    )
  }

  return { participants, messages, steps, groups }
}
