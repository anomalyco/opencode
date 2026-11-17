import { Schema } from "effect"

/** What the page says about a field whose value a snapshot would print. */
export const Field = Schema.Struct({
  type: Schema.String,
  autocomplete: Schema.String,
  /** Its id, name, placeholder, `aria-label` and label texts. */
  labels: Schema.Array(Schema.String),
  /** Whether the page masks its characters, as `-webkit-text-security` does. */
  masked: Schema.Boolean,
})

/** Reads `Field` from the element a CDP function runs on. */
export const describeField = `function() {
  return {
    type: this instanceof HTMLInputElement ? this.type : "",
    autocomplete: this.getAttribute("autocomplete") ?? "",
    labels: [this.id, this.getAttribute("name"), this.getAttribute("placeholder"), this.getAttribute("aria-label"), ...Array.from(this.labels ?? [], (label) => label.textContent)].filter(Boolean),
    masked: getComputedStyle(this).webkitTextSecurity !== "none",
  }
}`

const secretTokens = /^(current-password|new-password|one-time-code|cc-.+)$/

const secretWords = /passw|passcode|secret|token|card ?(number|num|no)\b|\b(pwd|otp|pin|cvv|cvc|ssn)\b/

/**
 * Whether a snapshot may print a field's value; `name` is its accessible name. Chromium keeps no type history, so a
 * password that a "show password" toggle turned into `type="text"` is recognised by its autocomplete, name or label.
 */
export function readableField(field: typeof Field.Type, name: string) {
  if (field.masked || /^(password|file)$/.test(field.type)) return false

  if (field.autocomplete.toLowerCase().split(/\s+/).some((token) => secretTokens.test(token))) return false

  return ![name, ...field.labels].some((label) =>
    secretWords.test(
      label
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[\W_]+/g, " ")
        .toLowerCase(),
    ),
  )
}
