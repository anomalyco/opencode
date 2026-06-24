import type { Widget } from "../widgets/Widget"

export interface WidgetState {
  id: string
  props: Record<string, unknown>
  widget: Widget
}

export class Reconciler {
  private states = new Map<string, Record<string, unknown>>()

  diff(id: string, newProps: Record<string, unknown>, widget: Widget): boolean {
    const old = this.states.get(id)
    if (!old) {
      this.states.set(id, { ...newProps })
      widget.invalidate()
      return true
    }

    let changed = false
    const keys = new Set([...Object.keys(old), ...Object.keys(newProps)])
    for (const key of keys) {
      if (old[key] !== newProps[key]) { changed = true; break }
    }

    if (changed) {
      this.states.set(id, { ...newProps })
      widget.invalidate()
    }

    return changed
  }

  reset(): void {
    this.states.clear()
  }
}
