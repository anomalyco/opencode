# TUI Notifications Default

Problem:

- v1 defaults `attention.enabled` to `false`
- users can opt in with `attention.enabled = true`
- v2 should make core TUI notifications a default behavior

## v2 Target

Flip `attention.enabled` to `true` by default in v2.

Keep `attention.enabled = false` as the explicit opt-out.
