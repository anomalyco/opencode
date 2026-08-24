# Proposal: GPU tuning surface in opencode (view + edit llama-skein profiles)

## Why

llama-skein is gaining per-GPU tuning profiles (see the companion change
`add-gpu-tuning-profiles`): it auto-injects verified llama-server flags
(flash attention, `--parallel 1`, MTP speculative decoding) per detected gfx
arch, and exposes them over `/api/tuning`. opencode is the operator's primary
window onto local providers, so it should show the detected GPU + active
profile and let the user tweak it without hand-editing YAML on the host.

## What

- Regenerate the llama-skein TS client from the updated spec (new
  `/api/tuning*` endpoints, `effective_flags` on model detail).
- A TUI dialog (reachable from the sidebar / a `/tuning` command) that, for
  the current session's local provider:
  - shows detected gfx, GPU device, and whether the profile is `verified`;
  - lists the effective profile flags (flash-attn, parallel, MTP);
  - shows the per-model delta (`effective_flags` vs the stored `cmd`) so the
    user sees what the profile added;
  - lets the user toggle flash attention, set parallel slots, and
    enable/disable MTP, via `PATCH /api/tuning`.
- Surface a small indicator that a verified/unverified profile is active.

## Constraints

- Generated client (`src/local/llama-skein/gen/`) is regenerated from the
  llama-skein spec, never hand-edited.
- Only shown for local llama-skein providers that answer `/api/tuning`;
  degrade silently for non-llama-skein / cloud providers.
- Editing is best-effort: a PATCH triggers a model reload on the host; the UI
  must not block on it and must reflect that already-running models change
  only on reload.

## Non-goals

- Reimplementing profile logic client-side — the server owns profiles;
  opencode is a view/editor over the API.
- Per-model flag editing beyond what `/api/config/models/:id` PATCH already
  supports (ctx size / offload live there already).
