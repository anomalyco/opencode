import type { Ref } from "solid-js"

export function isTabCloseTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('[data-slot="tab-close"]')
}

export function canStartTabDrag(pointerType: string) {
  return pointerType !== "touch"
}

export function isPrimaryPointerPressed(buttons: number) {
  return (buttons & 1) !== 0
}

export function captureTabPointerDown(element: HTMLDivElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect()
  return {
    startX: clientX,
    startY: clientY,
    grabOffsetX: clientX - rect.left,
    grabOffsetY: clientY - rect.top,
    width: rect.width,
    element,
  }
}

export function forwardTabRef(ref: Ref<HTMLDivElement> | undefined, element: HTMLDivElement) {
  if (typeof ref === "function") ref(element)
}

export function canOpenTabRename(dragging: boolean | undefined, editing: boolean, committing: boolean) {
  return !dragging && !editing && !committing
}

export function createTabDragPreview(element: HTMLDivElement) {
  return element.cloneNode(true) as HTMLDivElement
}
