import { normalizeStateDiagramEndpoint } from "./endpoint.js"
import type {
  StateDiagramActiveTransition,
  StateDiagramActiveTransitionSelection,
  StateDiagramTransition,
} from "./types.js"

type ActiveTransitionMatchTransition = StateDiagramTransition & {
  sourceTransitions?: readonly StateDiagramTransition[]
}

function normalizeActiveTransition(activeTransition: StateDiagramActiveTransition): StateDiagramActiveTransition {
  return {
    from: normalizeStateDiagramEndpoint(activeTransition.from, "from"),
    to: normalizeStateDiagramEndpoint(activeTransition.to, "to"),
    label: activeTransition.label,
  }
}

export function normalizeActiveTransitions(
  activeTransition: StateDiagramActiveTransitionSelection | undefined,
): StateDiagramActiveTransition[] {
  if (!activeTransition) return []
  const transitions = Array.isArray(activeTransition) ? activeTransition : [activeTransition]
  return transitions.map(normalizeActiveTransition)
}

function activeTransitionEqual(left: StateDiagramActiveTransition, right: StateDiagramActiveTransition): boolean {
  return left.from === right.from && left.to === right.to && left.label === right.label
}

function activeTransitionMatchesTransition(
  activeTransition: StateDiagramActiveTransition,
  transition: StateDiagramTransition,
): boolean {
  return (
    activeTransition.from === transition.from &&
    activeTransition.to === transition.to &&
    (activeTransition.label === undefined || activeTransition.label === transition.label)
  )
}

export function activeTransitionListsEqual(
  left: readonly StateDiagramActiveTransition[],
  right: readonly StateDiagramActiveTransition[],
): boolean {
  return (
    left.length === right.length && left.every((transition, index) => activeTransitionEqual(transition, right[index]!))
  )
}

export function isActiveTransition(
  transition: ActiveTransitionMatchTransition,
  activeTransitions: readonly StateDiagramActiveTransition[],
): boolean {
  return activeTransitionIndex(transition, activeTransitions) !== -1
}

export function activeTransitionIndex(
  transition: ActiveTransitionMatchTransition,
  activeTransitions: readonly StateDiagramActiveTransition[],
): number {
  const exactIndex = activeTransitions.findIndex((activeTransition) =>
    activeTransitionMatchesTransition(activeTransition, transition),
  )
  if (exactIndex !== -1) return exactIndex

  const sourceTransitions = transition.sourceTransitions
  if (!sourceTransitions || sourceTransitions.length <= 1 || activeTransitions.length < sourceTransitions.length)
    return -1

  for (let index = 0; index <= activeTransitions.length - sourceTransitions.length; index++) {
    const matches = sourceTransitions.every((sourceTransition, offset) => {
      const activeTransition = activeTransitions[index + offset]!
      return activeTransitionMatchesTransition(activeTransition, sourceTransition)
    })
    if (matches) return index
  }

  return -1
}
