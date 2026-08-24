# Spec delta: local-providers (add-gpu-tuning-ui)

## ADDED

### GPU tuning view + editor

- For a local provider that answers llama-skein's `GET /api/tuning`, the TUI
  MUST offer a tuning dialog (command `tuning.show`, palette `/tuning`, and a
  clickable sidebar badge) showing: detected gfx target, GPU device, whether
  the active profile is `verified`, the effective profile flags, and the
  per-model delta (`effective_flags` vs stored `cmd`).
- The dialog MUST present the profile as a recommendation the user can accept,
  change, or disable — never forced:
  - a master "auto-tune" enable/disable toggle (disable → server launches the
    `cmd` verbatim);
  - tri-state flash-attn and MTP (Recommended / On / Off), a parallel-slots
    stepper accepting any value, and a free-text `extra_args` field for flags
    the curated controls don't cover;
  - a "Reset to recommended" action clearing all overrides.
  Changes apply via `PATCH /api/tuning` (a null field resets that override).
  MTP "On" is disabled with a hint when the profile is unverified for the
  detected gfx.
- The effective-flags panel MUST tag each value `recommended` or `override`
  so the user sees exactly what they've changed.
- Applying a change MUST NOT block the UI and MUST indicate that
  already-running models take the change on next (re)load.

### Sidebar tuning badge

- When the current session's provider is local and exposes `/api/tuning`, the
  sidebar shows a compact profile badge (verified vs default). The badge read
  MUST reuse the existing hardware-poll effect and its abort/stale guard — no
  additional polling loop.

### Degradation

- Providers without `/api/tuning` (older llama-skein, non-llama-skein, cloud)
  MUST hide the badge and disable the tuning command; the sidebar and provider
  listing continue to function unchanged.
