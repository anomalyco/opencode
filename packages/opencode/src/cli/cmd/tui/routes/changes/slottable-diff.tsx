import { createEffect, onCleanup, splitProps, type JSX } from "solid-js"
import {
  SlottableDiffRenderable,
  type SlottableDiffOptions,
  BoxRenderable,
  type DiffLineClickInfo,
} from "@opentui/core"
import { createElement, insert, useRenderer } from "@opentui/solid"

export interface SlottableDiffProps extends SlottableDiffOptions {
  ref?: (el: SlottableDiffRenderable) => void
  lineSlots?: Map<number, JSX.Element>
}

export function SlottableDiff(props: SlottableDiffProps): JSX.Element {
  const renderer = useRenderer()
  let diffRef: SlottableDiffRenderable | null = null
  const slotContainers = new Map<number, BoxRenderable>()
  const [local, _] = splitProps(props, ["lineSlots", "ref"])

  // Create the underlying renderable
  const diffRenderable = new SlottableDiffRenderable(renderer, {
    id: `slottable-diff-${Date.now()}`,
    ...props,
  })

  diffRef = diffRenderable

  if (local.ref) {
    local.ref(diffRenderable)
  }

  createEffect(() => {
    if (!diffRef) return
    const newDiff = props.diff
    if (newDiff !== undefined) {
      diffRef.diff = newDiff
    }
  })

  createEffect(() => {
    if (!diffRef) return
    const newView = props.view
    if (newView !== undefined) {
      diffRef.view = newView
    }
  })

  createEffect(() => {
    if (!diffRef) return
    diffRef.onLineClick = props.onLineClick
  })

  // Reactive effect to manage slots
  createEffect(() => {
    const slots = local.lineSlots
    if (!diffRef) return

    const currentSlotIndices = new Set(slotContainers.keys())
    const newSlotIndices = slots ? new Set(slots.keys()) : new Set<number>()

    // Remove old slots
    for (const lineIndex of currentSlotIndices) {
      if (!newSlotIndices.has(lineIndex)) {
        diffRef.removeSlot(lineIndex)
        const container = slotContainers.get(lineIndex)
        if (container) {
          container.destroy()
          slotContainers.delete(lineIndex)
        }
      }
    }

    // Add/update slots
    if (slots) {
      for (const [lineIndex, jsxElement] of slots) {
        let container = slotContainers.get(lineIndex)

        if (!container) {
          container = createElement("box") as BoxRenderable
          slotContainers.set(lineIndex, container)
        } else {
          for (const child of container.getChildren()) {
            container.remove(child.id)
          }
        }

        // Use insert() to render JSX into container
        insert(container, () => jsxElement)

        // Add container to diff if not already there
        if (!diffRef.hasSlot(lineIndex)) {
          diffRef.insertSlot(lineIndex, container)
        }
      }
    }
  })

  // Cleanup on unmount
  onCleanup(() => {
    for (const container of slotContainers.values()) {
      container.destroy()
    }
    slotContainers.clear()
    if (diffRef) {
      diffRef.destroy()
    }
  })

  return diffRenderable as unknown as JSX.Element
}

export type { DiffLineClickInfo }
