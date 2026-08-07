import type { StateDiagram, StateDiagramState, StateDiagramTransition } from "./types.js"

export type StateVisibleTransition = StateDiagramTransition

export interface StateVisibleDiagram extends Omit<StateDiagram, "transitions"> {
  transitions: StateVisibleTransition[]
}

export function isHiddenCompositeMarker(state: StateDiagramState | undefined): boolean {
  return Boolean(state?.parentId && (state.kind === "start" || state.kind === "end"))
}

function composeTransitionLabel(incoming: StateDiagramTransition, outgoing: StateDiagramTransition): string {
  return incoming.label || outgoing.label
}

function collapseHiddenCompositeMarkerTransitionsOnce(
  transitions: readonly StateVisibleTransition[],
  statesById: ReadonlyMap<string, StateDiagramState>,
): { transitions: StateVisibleTransition[]; changed: boolean } {
  const hiddenMarkers = new Set(
    [...statesById.values()].filter((state) => isHiddenCompositeMarker(state)).map((state) => state.id),
  )
  if (hiddenMarkers.size === 0) return { transitions: [...transitions], changed: false }

  const skipped = new Set<StateVisibleTransition>()
  const collapsed: StateVisibleTransition[] = []
  let changed = false

  for (const markerId of hiddenMarkers) {
    const incoming = transitions.filter((transition) => transition.to === markerId && transition.from !== markerId)
    const outgoing = transitions.filter((transition) => transition.from === markerId && transition.to !== markerId)
    if (incoming.length === 0 || outgoing.length === 0) continue

    changed = true
    for (const incomingTransition of incoming) {
      skipped.add(incomingTransition)
      for (const outgoingTransition of outgoing) {
        skipped.add(outgoingTransition)
        collapsed.push({
          from: incomingTransition.from,
          to: outgoingTransition.to,
          label: composeTransitionLabel(incomingTransition, outgoingTransition),
        })
      }
    }
  }

  return {
    transitions: [...transitions.filter((transition) => !skipped.has(transition)), ...collapsed],
    changed,
  }
}

function collapseHiddenCompositeMarkerTransitions(diagram: StateDiagram): StateVisibleTransition[] {
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  let transitions: StateVisibleTransition[] = diagram.transitions.map((transition) => ({ ...transition }))

  while (true) {
    const result = collapseHiddenCompositeMarkerTransitionsOnce(transitions, statesById)
    transitions = result.transitions
    if (!result.changed) return transitions
  }
}

export function prepareVisibleStateDiagram(diagram: StateDiagram): StateVisibleDiagram {
  const transitions = collapseHiddenCompositeMarkerTransitions(diagram)
  const referencedHiddenMarkers = new Set<string>()
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  for (const transition of transitions) {
    const from = statesById.get(transition.from)
    const to = statesById.get(transition.to)
    if (from && isHiddenCompositeMarker(from)) referencedHiddenMarkers.add(from.id)
    if (to && isHiddenCompositeMarker(to)) referencedHiddenMarkers.add(to.id)
  }

  return {
    ...diagram,
    states: diagram.states.filter((state) => !isHiddenCompositeMarker(state) || referencedHiddenMarkers.has(state.id)),
    transitions,
  }
}
