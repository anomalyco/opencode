import { RawMode } from "./RawMode"
import { TerminalManager } from "../window/TerminalManager"

export class RawAdapter {
  private rawMode = new RawMode()
  private terminal = new TerminalManager()
  private active = false

  enable(): void {
    if (this.active) return
    this.terminal.startup()
    this.rawMode.enable()
    this.active = true
  }

  restore(): void {
    if (!this.active) return
    this.rawMode.restore()
    this.terminal.shutdown()
    this.active = false
  }

  get isActive(): boolean {
    return this.active
  }
}
