# Spec delta: local-providers (ctx-display-and-overflow-correctness)

## MODIFIED

### Context display reflects the enforced limit

- The context usage indicator MUST use the enforced per-request context
  (`configured_ctx` / `contextMax`) as its ceiling, not `max_safe_ctx` and
  never the models.dev catalog native context. A model launched with
  `--ctx-size N` MUST display a ceiling of `N` (divided by parallel slots where
  applicable), so the displayed limit matches the size at which requests are
  actually accepted or rejected.

### A ctx-size set persists

- After the user sets a model's ctx-size and the backend PATCH succeeds,
  opencode MUST refresh that provider's discovered state so the displayed limit
  reflects the new enforced value. The set value MUST NOT revert to a
  capacity/budget number on the next discovery.

### Overflow auto-patch stays loadable

- On a 413/context-overflow from a local provider, when opencode auto-adjusts
  `ctx_size` it MUST choose a VRAM-safe value derived from `/api/fit` for the
  current hardware, never the model's raw native maximum. When no safe value is
  available opencode MUST surface the overflow to the user/caller instead of
  writing an unloadable ctx-size.
