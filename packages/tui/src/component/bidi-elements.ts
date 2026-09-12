import { extend } from "@opentui/solid"
import { BidiTextRenderable } from "./bidi-text"
import { BidiTextareaRenderable } from "./bidi-textarea"

// Registers the bidi-aware elements with the OpenTUI solid catalogue so they
// can be used as <bidi_text> and <bidi_textarea> in JSX. Import this module
// from any component that renders them.
extend({
  bidi_text: BidiTextRenderable,
  bidi_textarea: BidiTextareaRenderable,
})

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    bidi_text: typeof BidiTextRenderable
    bidi_textarea: typeof BidiTextareaRenderable
  }
}
