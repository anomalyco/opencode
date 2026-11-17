import { Schema } from "effect"

/** What the page says about a field whose value a snapshot would print. */
export const Field = Schema.Struct({
  type: Schema.String,
  autocomplete: Schema.String,
  /** Its id, name, placeholder, `aria-label` and label texts. */
  labels: Schema.Array(Schema.String),
  /** Whether the page masks its characters, as `-webkit-text-security` does. */
  masked: Schema.Boolean,
  /** An input's `maxLength`, -1 when it has none. */
  maxLength: Schema.Number,
  /** The `aria-label` or text of buttons beside the field, such as "Show password". */
  toggles: Schema.Array(Schema.String),
})

/**
 * Reads `Field` from the element a CDP function runs on. Buttons count as the field's own only when it is the only
 * field in its parent, so a login form's "Show password" does not hide its username.
 */
export const describeField = `function() {
  const parent = this.parentElement
  const own = parent && parent.querySelectorAll("input, textarea, [contenteditable]").length === 1
  return {
    type: this instanceof HTMLInputElement ? this.type : "",
    autocomplete: this.getAttribute("autocomplete") ?? "",
    labels: [this.id, this.getAttribute("name"), this.getAttribute("placeholder"), this.getAttribute("aria-label"), ...Array.from(this.labels ?? [], (label) => label.textContent)].filter(Boolean),
    masked: getComputedStyle(this).webkitTextSecurity !== "none",
    maxLength: this instanceof HTMLInputElement ? this.maxLength : -1,
    toggles: own ? Array.from(parent.querySelectorAll('button, [role="button"]'), (button) => button.getAttribute("aria-label") || button.textContent).filter(Boolean) : [],
  }
}`

const secretTokens = /^(current-password|new-password|one-time-code|cc-.+)$/

const secretWords =
  /passw|passcode|secret|\btoken\b|\b(api|private|access|signing|auth|ssh|webhook|encryption) ?key\b|\b(security|verification|recovery|backup) ?code\b|card ?(number|num|no)\b|\b(pwd|otp|totp|2fa|mfa|pin|cvv|cvc|ssn)\b/

/**
 * Whether a snapshot may print a field's value; `name` is its accessible name. When unsure, it hides. Chromium keeps
 * no type history, so a password that a "show password" toggle turned into `type="text"` is recognised by its
 * autocomplete, name, label or that toggle; a split one-time code by its one-character boxes.
 */
export function readableField(field: typeof Field.Type, name: string) {
  if (field.masked || /^(password|file)$/.test(field.type)) return false

  if (field.maxLength === 1 && /^(text|tel|number)$/.test(field.type)) return false

  if (field.autocomplete.toLowerCase().split(/\s+/).some((token) => secretTokens.test(token))) return false

  return ![name, ...field.labels, ...field.toggles].some((label) =>
    secretWords.test(
      label
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[\W_]+/g, " ")
        .toLowerCase(),
    ),
  )
}
