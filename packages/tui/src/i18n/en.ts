// English source dictionary for the TUI. Keys are stable identifiers; values are
// the existing designer-written copy. A locale overrides a subset of these keys
// and falls back to English for the rest. `Key` is derived from this object, so
// a call site that names a key not listed here does not typecheck.
export const dict = {
  "dialog.alert.confirm": "Confirm alert",
  "dialog.alert.ok": "ok",

  "permission.action.read": "Read",
  "permission.action.list": "List",
  "permission.action.glob": "Glob",
  "permission.action.grep": "Grep",
  "permission.action.shell": "Shell command",
  "permission.field.path": "Path: {{path}}",
  "permission.field.pattern": "Pattern: {{pattern}}",
  "permission.option.once": "Allow once",
  "permission.option.always": "Always allow",
  "permission.option.reject": "Reject",
  "permission.option.confirm": "Confirm",
  "permission.option.cancel": "Cancel",
  "permission.always.wildcard": "This will always allow {{action}} for this project.",
  "permission.always.patterns": "This will always allow the following patterns for this project.",
} as const

export type Key = keyof typeof dict
