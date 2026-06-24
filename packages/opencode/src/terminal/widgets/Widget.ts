import { ScreenBuffer } from "../core/ScreenBuffer"
import type { InputEvent } from "../input/InputHandler"

export interface Widget {
  readonly dirty: boolean
  setBounds(x: number, y: number, w: number, h: number): void
  invalidate(): void
  render(buffer: ScreenBuffer): void
  onKey?(event: InputEvent): boolean
  onFocus?(): void
  onBlur?(): void
}
