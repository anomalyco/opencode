import { decodeMermaidText, firstMeaningfulMermaidLine, numberedMermaidLines } from "../core/mermaid.js"
import { splitDiagramLines } from "../core/text-lines.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import { normalizeStateDiagramEndpoint, stateDiagramEndMarkerId, stateDiagramStartMarkerId } from "./endpoint.js"
import type {
  StateDiagram,
  StateDiagramCompositeState,
  StateDiagramDirection,
  StateDiagramNote,
  StateDiagramState,
  StateDiagramTransition,
} from "./types.js"

const DEFAULT_DIRECTION = "LR" satisfies StateDiagramDirection
const STATE_RE = /^state\s+"([^"]+)"\s+as\s+(\S+)$/i
const COMPOSITE_STATE_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?(\S+)\s*\{$/i
const CHOICE_STATE_RE = /^state\s+(\S+)\s+<<choice>>$/i
const TRANSITION_RE = /^(\[\*\]|[^\s:]+)\s*-->\s*(\[\*\]|[^\s:]+)(?:\s*:\s*(.*))?$/
const DIRECTION_RE = /^direction\s+(TB|TD|LR|RL)$/i
const NOTE_INLINE_RE = /^note\s+(left|right)\s+of\s+(\S+)\s*:\s*(.*)$/i
const NOTE_START_RE = /^note\s+(left|right)\s+of\s+(\S+)\s*$/i
const NOTE_END_RE = /^end\s+note$/i

function normalizeDirection(value?: string): StateDiagramDirection {
  const upper = value?.toUpperCase()
  if (upper === "TB" || upper === "TD" || upper === "LR" || upper === "RL") return upper
  return DEFAULT_DIRECTION
}

function isMermaidHeader(line: string): boolean {
  return line.toLowerCase() === "statediagram-v2" || line.toLowerCase() === "statediagram"
}

function ensureState(
  states: Map<string, StateDiagramState>,
  id: string,
  label = id,
  kind: StateDiagramState["kind"] = "state",
  parentId?: string,
): void {
  const existing = states.get(id)
  if (existing) {
    if (existing.label === existing.id && label !== id) existing.label = label
    if (parentId && !existing.parentId) existing.parentId = parentId
    if (kind !== "state") {
      existing.kind = kind
      existing.label = label
    }
    return
  }
  states.set(id, parentId ? { id, label, kind, parentId } : { id, label, kind })
}

function resolveCompositeTransitionEndpoint(
  id: string,
  markerId: (scope?: string) => string,
  compositeIds: ReadonlySet<string>,
  states: Map<string, StateDiagramState>,
): string {
  if (!compositeIds.has(id)) return id
  const marker = markerId(id)
  return states.has(marker) ? marker : id
}

function resolveCompositeTransitions(
  transitions: readonly StateDiagramTransition[],
  compositeIds: ReadonlySet<string>,
  states: Map<string, StateDiagramState>,
): StateDiagramTransition[] {
  return transitions.map((transition) => ({
    from: resolveCompositeTransitionEndpoint(transition.from, stateDiagramEndMarkerId, compositeIds, states),
    to: resolveCompositeTransitionEndpoint(transition.to, stateDiagramStartMarkerId, compositeIds, states),
    label: transition.label,
  }))
}

export function isMermaidStateDiagram(content: string): boolean {
  return isMermaidHeader(firstMeaningfulMermaidLine(content) ?? "")
}

export function parseMermaidStateDiagram(content: string): StateDiagram {
  const states = new Map<string, StateDiagramState>()
  const transitions: StateDiagramTransition[] = []
  const composites: StateDiagramCompositeState[] = []
  const notes: StateDiagramNote[] = []
  const parentStack: Array<{ id: string; lineNumber: number; sourceLine: string }> = []
  let pendingNote:
    | { target: string; position: "left" | "right"; lines: string[]; lineNumber: number; sourceLine: string }
    | undefined
  let direction: StateDiagramDirection = DEFAULT_DIRECTION

  for (const source of numberedMermaidLines(content)) {
    const line = source.text
    if (pendingNote) {
      if (NOTE_END_RE.test(line)) {
        notes.push({
          target: pendingNote.target,
          position: pendingNote.position,
          lines: pendingNote.lines.map(decodeMermaidText),
        })
        pendingNote = undefined
      } else if (line || pendingNote.lines.length > 0) {
        pendingNote.lines.push(line)
      }
      continue
    }

    if (!line || line.startsWith("%%") || isMermaidHeader(line)) continue

    if (line === "}") {
      if (parentStack.length === 0) {
        throw new MermaidSyntaxError("state", source.lineNumber, line, 'Unexpected "}" without an open composite state')
      }
      parentStack.pop()
      continue
    }

    const parentId = parentStack[parentStack.length - 1]?.id

    const directionMatch = line.match(DIRECTION_RE)
    if (directionMatch) {
      if (parentStack.length > 0) {
        throw new MermaidSyntaxError("state", source.lineNumber, line, "Composite-local direction is not supported")
      }
      direction = normalizeDirection(directionMatch[1])
      continue
    }

    const inlineNoteMatch = line.match(NOTE_INLINE_RE)
    if (inlineNoteMatch) {
      notes.push({
        position: inlineNoteMatch[1]!.toLowerCase() as "left" | "right",
        target: inlineNoteMatch[2]!,
        lines: splitDiagramLines(decodeMermaidText(inlineNoteMatch[3]!.trim())),
      })
      continue
    }

    const noteMatch = line.match(NOTE_START_RE)
    if (noteMatch) {
      pendingNote = {
        position: noteMatch[1]!.toLowerCase() as "left" | "right",
        target: noteMatch[2]!,
        lines: [],
        lineNumber: source.lineNumber,
        sourceLine: line,
      }
      continue
    }

    const compositeMatch = line.match(COMPOSITE_STATE_RE)
    if (compositeMatch) {
      const id = compositeMatch[2]!
      composites.push({
        id,
        label: decodeMermaidText(compositeMatch[1] ?? id),
        ...(parentId ? { parentId } : {}),
      })
      parentStack.push({ id, lineNumber: source.lineNumber, sourceLine: line })
      continue
    }

    const stateMatch = line.match(STATE_RE)
    if (stateMatch) {
      ensureState(states, stateMatch[2]!, decodeMermaidText(stateMatch[1]!), "state", parentId)
      continue
    }

    const choiceMatch = line.match(CHOICE_STATE_RE)
    if (choiceMatch) {
      ensureState(states, choiceMatch[1]!, "", "choice", parentId)
      continue
    }

    const transitionMatch = line.match(TRANSITION_RE)
    if (transitionMatch) {
      const rawFrom = transitionMatch[1]!
      const rawTo = transitionMatch[2]!
      const from = normalizeStateDiagramEndpoint(rawFrom, "from", parentId)
      const to = normalizeStateDiagramEndpoint(rawTo, "to", parentId)
      ensureState(states, from, rawFrom === "[*]" ? "●" : from, rawFrom === "[*]" ? "start" : "state", parentId)
      ensureState(states, to, rawTo === "[*]" ? "◎" : to, rawTo === "[*]" ? "end" : "state", parentId)
      transitions.push({ from, to, label: decodeMermaidText(transitionMatch[3]?.trim() ?? "") })
      continue
    }

    throw new MermaidSyntaxError("state", source.lineNumber, line)
  }

  if (pendingNote) {
    throw new MermaidSyntaxError(
      "state",
      pendingNote.lineNumber,
      pendingNote.sourceLine,
      'Unclosed note; expected "end note"',
    )
  }

  const unclosedComposite = parentStack[parentStack.length - 1]
  if (unclosedComposite) {
    throw new MermaidSyntaxError(
      "state",
      unclosedComposite.lineNumber,
      unclosedComposite.sourceLine,
      'Unclosed composite state; expected "}"',
    )
  }

  if (composites.length === 0) {
    return { direction, states: [...states.values()], transitions, composites, notes }
  }

  const compositeIds = new Set(composites.map((composite) => composite.id))
  return {
    direction,
    states: [...states.values()].filter((state) => !compositeIds.has(state.id)),
    transitions: resolveCompositeTransitions(transitions, compositeIds, states),
    composites,
    notes,
  }
}
