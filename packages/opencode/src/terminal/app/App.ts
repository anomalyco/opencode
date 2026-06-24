import { TerminalManager } from "../window/TerminalManager"
import { DoubleBuffer } from "../buffer/DoubleBuffer"
import { InputHandler } from "../input/InputHandler"
import type { InputEvent } from "../input/InputHandler"
import { getTermSize, listenResize } from "../window/WindowSize"
import type { TermSize } from "../window/WindowSize"
import { AnsiCodes } from "../utils/AnsiCodes"
import { SgrDelta } from "../core/SgrDelta"
import { Scheduler } from "./Scheduler"
import type { Widget } from "../widgets/Widget"
import { Reconciler } from "./Reconciler"
import { FocusManager } from "./FocusManager"

export class App {
  private terminal: TerminalManager
  private scheduler: Scheduler
  private input: InputHandler
  private doubleBuffer: DoubleBuffer | null = null
  private sgrDelta: SgrDelta
  private widgets: Widget[] = []
  private resizeCleanup: (() => void) | null = null
  private inputCleanup: (() => void) | null = null
  private running = false
  private tickCleanup: (() => void) | null = null
  readonly reconciler = new Reconciler()
  readonly focusManager = new FocusManager()

  constructor(terminal: TerminalManager) {
    this.terminal = terminal
    this.scheduler = new Scheduler()
    this.input = new InputHandler()
    this.sgrDelta = new SgrDelta()
  }

  mount(widget: Widget): void {
    if (this.running) throw new Error("[App] Cannot mount while running")
    this.widgets.push(widget)
  }

  start(): void {
    if (this.running) return
    this.terminal.startup()
    this.running = true

    const size = getTermSize()
    this.doubleBuffer = new DoubleBuffer(size.width, size.height)
    this.sgrDelta.resetState()

    this.scheduler.onRender(() => this.render())
    this.scheduler.start()

    this.tickCleanup = this.scheduler.onTick(() => this.onTick())

    this.input.attach()
    this.inputCleanup = this.input.on((event) => this.onInput(event))

    this.resizeCleanup = listenResize((s) => this.onResize(s))

    for (const w of this.widgets) w.invalidate()
    this.scheduler.requestFrame()
  }

  stop(): void {
    if (!this.running) return
    this.running = false

    this.tickCleanup?.()
    this.scheduler.stop()
    this.inputCleanup?.()
    this.inputCleanup = null
    this.input.detach()

    this.resizeCleanup?.()
    this.resizeCleanup = null

    this.sgrDelta.resetState()
    this.terminal.shutdown()
  }

  private render(): boolean {
    const db = this.doubleBuffer
    if (!db) return true

    const size = getTermSize()
    for (const w of this.widgets) {
      w.setBounds(0, 0, size.width, size.height)
    }

    const back = db.getBack()
    back.clear()

    for (const w of this.widgets) {
      if (w.dirty) w.render(back)
    }

    const ansi = db.swap()
    const optimized = this.sgrDelta.optimize(ansi)
    const output = AnsiCodes.cursorHome + optimized

    const result = process.stdout.write(output)
    return result !== false
  }

  private onInput(event: InputEvent): void {
    if (event.type === "KEY") {
      if (event.key === "Ctrl+C" || event.key === "q") {
        this.stop()
        return
      }
      if (event.key === "Tab") {
        this.focusManager.focusNext()
        this.scheduler.requestFrame()
        return
      }
      if (event.key === "Shift+Tab") {
        this.focusManager.focusPrev()
        this.scheduler.requestFrame()
        return
      }
    }

    const focused = this.focusManager.focused
    if (focused?.onKey?.(event)) {
      this.scheduler.requestFrame()
      return
    }

    for (const w of this.widgets) w.invalidate()
    this.scheduler.requestFrame()
  }

  private tickCount = 0

  private onTick(): void {
    this.tickCount++
    const focused = this.focusManager.focused
    if (focused && cursorVisible(focused)) {
      if (this.tickCount % 5 === 0) {
        focused.cursorVisible = !focused.cursorVisible
        focused.invalidate()
        this.scheduler.requestFrame()
      }
    }
  }

  private onResize(size: TermSize): void {
    if (!this.doubleBuffer) return
    this.doubleBuffer.resize(size.width, size.height)
    for (const w of this.widgets) w.invalidate()
    this.scheduler.requestFrame()
  }
}

function cursorVisible(w: Widget): w is Widget & { cursorVisible: boolean } {
  return "cursorVisible" in w
}
