import type { Widget } from "../widgets/Widget"

export class FocusManager {
  private focusables: { id: string; widget: Widget }[] = []
  private index = -1

  add(id: string, widget: Widget): void {
    const has = this.focusables.some(f => f.id === id)
    if (!has) this.focusables.push({ id, widget })
  }

  remove(id: string): void {
    const i = this.focusables.findIndex(f => f.id === id)
    if (i === -1) return
    const wasFocused = i === this.index
    this.focusables.splice(i, 1)
    if (wasFocused) {
      if (this.focusables.length === 0) this.index = -1
      else this.index = Math.min(this.index, this.focusables.length - 1)
    } else if (i < this.index) this.index--
  }

  get focused(): Widget | null {
    if (this.index < 0 || this.index >= this.focusables.length) return null
    return this.focusables[this.index]!.widget
  }

  get focusId(): string | null {
    if (this.index < 0 || this.index >= this.focusables.length) return null
    return this.focusables[this.index]!.id
  }

  focusById(id: string): boolean {
    const i = this.focusables.findIndex(f => f.id === id)
    if (i === -1) return false
    return this.setFocus(i)
  }

  focusNext(): void {
    if (this.focusables.length === 0) return
    const next = this.index < 0 ? 0 : (this.index + 1) % this.focusables.length
    this.setFocus(next)
  }

  focusPrev(): void {
    if (this.focusables.length === 0) return
    const prev = this.index < 0 ? this.focusables.length - 1 : (this.index - 1 + this.focusables.length) % this.focusables.length
    this.setFocus(prev)
  }

  private setFocus(i: number): boolean {
    if (i < 0 || i >= this.focusables.length) return false
    if (i === this.index) return false

    const old = this.index >= 0 ? this.focusables[this.index] : null
    const next = this.focusables[i]!

    if (old) {
      old.widget.onBlur?.()
      old.widget.invalidate()
    }

    this.index = i
    next.widget.onFocus?.()
    next.widget.invalidate()
    return true
  }

  get count(): number { return this.focusables.length }
}
