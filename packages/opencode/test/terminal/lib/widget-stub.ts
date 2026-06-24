import type { Widget } from "@/terminal/widgets/Widget"
import type { InputEvent } from "@/terminal/input/InputHandler"

export function widgetStub(overrides?: Partial<Widget>): Widget {
  return {
    dirty: false,
    setBounds: () => {},
    invalidate: () => {},
    render: () => {},
    onKey: (event: InputEvent) => false,
    onFocus: () => {},
    onBlur: () => {},
    ...overrides,
  }
}
