// Keyboard focus and pointer capture (widgets-input.md): a widget takes the keyboard when clicked, tapped or tabbed
// to, and the mouse (Pointer Lock) on the next click after it asks; Esc always releases both, and is never delivered.

import type { WidgetEvent } from "./protocol.js"
import type { Ticker } from "./render.js"

/** What the input layer needs from its widget. */
export interface InputHost {
  readonly element: HTMLElement
  readonly shadow: ShadowRoot
  readonly ticker: Ticker
  /** Open (interactive), not submitted or dismissed. */
  open(): boolean
  emit(event: WidgetEvent): void
  /** The program wants the pointer: root `capture: "pointer"` or a live `capturePointer()`. */
  wantsPointer(): boolean
  /** The pointer was released by Esc or the browser: a live `capturePointer()` must ask again. */
  pointerReleased(): void
  /** Esc (pressed, or ending Pointer Lock): besides releasing both, it closes full screen. */
  escape(): void
  /** The `id` for captured pointer events: the first canvas or shader with one. */
  pointerId(): string
  /** That canvas's logical size: a wheel's page under capture (widgets-input.md, Wheel). */
  pointerSize(): { width: number; height: number }
  /**
   * Focus or capture changed (or the first key from a hardware keyboard arrived): show or hide the ring and the hint.
   * `keys`: a physical keyboard is known to be there (on touch devices, the hint shows only then).
   */
  changed(focused: boolean, captured: boolean, keys: boolean): void
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
const EDITABLE = 'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]), textarea, [contenteditable=""], [contenteditable="true"]'
const ACTIVATES = 'button, a[href], input, [role=button], [role=radio], [role=checkbox]'
const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"])

export class Input {
  private focused = false
  /** A key reached the widget outside text fields: there is a hardware keyboard. */
  private keys = false
  private locked = false
  private held = new Map<string, string>()
  private dx = 0
  private dy = 0
  /** The wheel under capture, summed until the frame's flush. */
  private wheelX = 0
  private wheelY = 0
  /** A release we asked for (the program let go): focus stays. */
  private letGo = false
  private readonly doc: Document

  constructor(private h: InputHost) {
    const el = h.element
    this.doc = el.ownerDocument
    el.addEventListener("focusin", this.onFocusIn)
    el.addEventListener("focusout", this.onFocusOut)
    el.addEventListener("keydown", this.onKey)
    el.addEventListener("keyup", this.onKey)
    el.addEventListener("pointerdown", this.onPointerDown)
    this.doc.addEventListener("pointerlockchange", this.onLockChange)
    this.doc.defaultView?.addEventListener("blur", this.onWindowBlur)
    this.refresh()
  }

  /** The widget's state or view changed: focusable while open; let the pointer go when no longer wanted. */
  refresh() {
    const open = this.h.open()
    if (open) this.h.element.tabIndex = 0
    else this.h.element.removeAttribute("tabindex")
    if (!open) this.release()
    else if (this.locked && !this.h.wantsPointer()) {
      this.letGo = true
      this.doc.exitPointerLock()
    }
  }

  /** Esc, leaving full screen, the window losing focus: give back the pointer and the keyboard at once. */
  release() {
    if (this.locked) {
      // Our own let-go: the lock change that follows isn't another Esc.
      this.letGo = true
      this.h.pointerReleased()
      this.doc.exitPointerLock()
    }
    const inner = this.h.shadow.activeElement as HTMLElement | null
    inner?.blur()
    if (this.doc.activeElement === this.h.element) this.h.element.blur()
    if (this.focused) this.blurred()
  }

  destroy() {
    this.release()
    const el = this.h.element
    el.removeEventListener("focusin", this.onFocusIn)
    el.removeEventListener("focusout", this.onFocusOut)
    el.removeEventListener("keydown", this.onKey)
    el.removeEventListener("keyup", this.onKey)
    el.removeEventListener("pointerdown", this.onPointerDown)
    this.doc.removeEventListener("pointerlockchange", this.onLockChange)
    this.doc.defaultView?.removeEventListener("blur", this.onWindowBlur)
    this.stopMoves()
  }

  private onFocusIn = () => {
    if (this.focused || !this.h.open()) return
    this.focused = true
    this.h.emit({ id: "", type: "focus", value: true })
    this.h.changed(true, this.locked, this.keys)
  }

  private onFocusOut = () => {
    // Focus moving between elements inside the widget isn't a blur of the widget.
    queueMicrotask(() => {
      if (this.focused && !this.h.element.matches(":focus, :focus-within")) this.blurred()
    })
  }

  private blurred() {
    this.focused = false
    for (const [code, key] of this.held)
      this.h.emit({ id: "", type: "key", value: { kind: "up", key, code, repeat: false, shift: false, alt: false, ctrl: false, meta: false } })
    this.held.clear()
    this.h.emit({ id: "", type: "focus", value: false })
    this.h.changed(false, this.locked, this.keys)
  }

  private onWindowBlur = () => this.release()

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // Never delivered; always releases both.
      if (e.type === "keydown" && (this.focused || this.locked)) {
        e.preventDefault()
        e.stopPropagation()
        this.release()
        this.h.escape()
      }
      return
    }
    if (!this.focused || !this.h.open()) return
    const target = (e.composedPath()[0] ?? e.target) as Element
    // Text fields keep their keys; Tab moves focus; controls keep their activation (and sliders, options their arrows).
    if (target instanceof Element && target.closest(EDITABLE)) return
    if (e.key === "Tab") return
    if (target instanceof Element && target.closest(ACTIVATES)) {
      if (e.key === "Enter" || e.key === " ") return
      if (ARROWS.has(e.key) && target.closest("input[type=range], [role=radio], [role=checkbox], .pw-carousel")) return
    }
    if (target instanceof Element && target.closest(".pw-carousel") && ARROWS.has(e.key)) return
    // The platform's command chords (Cmd on macOS, Ctrl elsewhere) still reach the app.
    if (MAC ? e.metaKey : e.ctrlKey) return
    e.preventDefault()
    e.stopPropagation()
    const down = e.type === "keydown"
    if (down && !this.keys) {
      this.keys = true
      this.h.changed(this.focused, this.locked, true)
    }
    if (down) this.held.set(e.code, e.key)
    else if (!this.held.delete(e.code)) return
    this.h.emit({
      id: "",
      type: "key",
      value: { kind: down ? "down" : "up", key: e.key, code: e.code, repeat: e.repeat, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey },
    })
  }

  private onPointerDown = () => {
    if (!this.h.open() || this.locked || !this.h.wantsPointer()) return
    // Granted on a click inside the widget: the browser needs the user gesture.
    try {
      const r = this.h.element.requestPointerLock() as unknown as Promise<void> | undefined
      r?.catch(() => {})
    } catch {}
  }

  private onLockChange = () => {
    const locked = this.doc.pointerLockElement === this.h.element
    if (locked === this.locked) return
    this.locked = locked
    if (locked) {
      this.doc.addEventListener("mousemove", this.onMove)
      this.doc.addEventListener("mousedown", this.onButton)
      this.doc.addEventListener("mouseup", this.onButton)
      this.doc.addEventListener("wheel", this.onWheel, { passive: false })
      if (!this.focused) this.h.element.focus({ preventScroll: true })
      this.h.emit({ id: "", type: "capture", value: true })
    } else {
      this.stopMoves()
      this.flush()
      this.h.emit({ id: "", type: "capture", value: false })
      if (this.letGo) this.letGo = false
      else {
        // Esc (which the browser takes itself while the pointer is locked) or the browser letting go: both go, and
        // full screen closes.
        this.h.pointerReleased()
        this.release()
        this.h.escape()
      }
    }
    this.h.changed(this.focused, locked, this.keys)
  }

  private stopMoves() {
    this.doc.removeEventListener("mousemove", this.onMove)
    this.doc.removeEventListener("mousedown", this.onButton)
    this.doc.removeEventListener("mouseup", this.onButton)
    this.doc.removeEventListener("wheel", this.onWheel)
    this.h.ticker.delete(this.flush)
  }

  private onMove = (e: MouseEvent) => {
    this.dx += e.movementX
    this.dy += e.movementY
    // At most one relative move a frame.
    this.h.ticker.add(this.flush)
  }

  // The wheel is delivered only under pointer capture (widgets-input.md, Wheel), where captured moves go, as
  // `{ kind: "wheel", dx, dy }`, and then the page doesn't scroll; otherwise there is no listener and the page scrolls
  // as usual. Lines are 40 px, pages that canvas's logical height (its width for `dx`).
  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const page = e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.h.pointerSize() : undefined
    const [ux, uy] = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? [40, 40] : page ? [page.width, page.height] : [1, 1]
    this.wheelX += e.deltaX * ux
    this.wheelY += e.deltaY * uy
    this.h.ticker.add(this.flush)
  }

  // At most one relative move and one wheel a frame.
  private flush = () => {
    this.h.ticker.delete(this.flush)
    if (this.dx !== 0 || this.dy !== 0) {
      const value = { kind: "move", dx: this.dx, dy: this.dy }
      this.dx = this.dy = 0
      this.h.emit({ id: this.h.pointerId(), type: "pointer", value })
    }
    if (this.wheelX !== 0 || this.wheelY !== 0) {
      const value = { kind: "wheel", dx: this.wheelX, dy: this.wheelY }
      this.wheelX = this.wheelY = 0
      this.h.emit({ id: this.h.pointerId(), type: "pointer", value })
    }
  }

  private onButton = (e: MouseEvent) => {
    this.flush()
    this.h.emit({ id: this.h.pointerId(), type: "pointer", value: { kind: e.type === "mousedown" ? "down" : "up", button: e.button } })
  }
}
