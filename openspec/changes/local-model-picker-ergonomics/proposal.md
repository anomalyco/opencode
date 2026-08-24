# Local model picker ergonomics

## Why

Picking a local model is a four-step search when it should be one or two. The
reported workflow is: open `/models`, type a provider name (`rocky`, `z4`),
squint at interleaved results, then find the model. Four separate defects make
that necessary, and each one is small.

Read from `packages/tui/src/component/dialog-model.tsx` (the TUI picker — not
`packages/app`'s `dialog-select-model.tsx`, which already groups by provider,
and not `dialog-connect-provider`, which is about *connecting* a provider, not
choosing a model).

**1. A provider-name query does not mean "show me this provider".** The query
runs through `fuzzysort.go(needle, options, { keys: ["title", "category"] })`
(`dialog-model.tsx:174`) where `category` is the provider. A match on the
provider name scores as one result among many, so typing `rocky` interleaves
rocky's models with any model whose *own* name fuzzy-matches those letters,
across every provider. The intent — "I have chosen the host, now show me what
it has" — is expressible and is not expressed.

**2. Selecting a provider does not use its default model.** llama-skein already
has this: `Model.default` is in the contract, documented as *"True when this
model is the configured default … Listed first in the model list"*, with
`GET/DELETE /api/models/default` to read and clear it. The picker ignores the
flag entirely. An operator who has already told the host which model to prefer
still has to restate it on every selection.

**3. Sort order is meaningless for local models.** `sortModelOptions`
(`dialog-model.tsx:286`) sorts by `releaseDate` then `title`. Local GGUFs have
no release date, so this degenerates to alphabetical. The operator's actual
ranking criterion for a local host is size — the largest quantisation that fits
is the best one available — and that is now knowable: `size_bytes` is in the
contract and rides on each model.

**4. The metadata line pairs the wrong things.** Today the size is a `footer`
(`"19G"`) while the provider label is `provenance` = `` `${name} · ${label}` ``
(`dialog-model.tsx:59-62`), rendering as `rocky · 20/24 GB` somewhere else on
the row. So model size and host VRAM — the two numbers a reader compares to
answer *will this fit* — are separated, while VRAM is glued to a hostname it
has no arithmetic relationship with. `19G/24GB rocky` puts the comparison in
one token and leaves the hostname as the label it is.

## What Changes

- **A provider-name match becomes a provider scope.** When the query
  unambiguously matches one provider, the picker lists that provider's models,
  all of them, rather than ranking them against unrelated fuzzy hits. Typing
  more narrows within the provider.
- **Selecting a provider selects its default model.** Where a provider reports
  a model with `default: true`, choosing the provider row resolves to that
  model directly. Providers with no default keep today's behaviour and expand
  to their model list.
- **Size-first ordering for local providers.** Models from a provider that
  reports `size_bytes` sort largest first. Alphabetical remains available and
  remains the default for providers without size data — a cloud catalogue
  sorted by weight file is nonsense.
- **`size/vram host` on one line.** The size and the host's VRAM render
  together (`19G/24GB rocky`), so the fit comparison is one glance. VRAM is
  omitted rather than faked when the host does not report it.

## Capabilities

### Modified Capabilities

- `local-model-picker`: provider-scoped querying, default-model resolution,
  size ordering, and the combined size/VRAM label.

## Non-Goals

- **Not** a change to `packages/app`'s `dialog-select-model.tsx`. It already
  groups by provider; whether it needs the same treatment is a separate
  question and a separate reading of its behaviour.
- **Not** fit enforcement. The picker reports size against VRAM; refusing an
  oversized selection is llama-skein's `/api/fit` guard and
  `flag-under-offloaded-models`, not this.
- **Not** a change to llama-skein. Every field this needs — `size_bytes`,
  `default` — is already in the contract and already generated.
- **Not** recency ordering for cloud providers. `sortModelOptions`'
  `releaseDate` behaviour is correct where a release date exists and is
  untouched.

## Open Questions

- **What counts as an unambiguous provider match?** Exact, case-insensitive
  equality on the provider name is the safe bar. Prefix matching is friendlier
  (`roc` → rocky) but two providers sharing a prefix would silently scope to
  one. Leaning exact-or-unique-prefix, with the scope shown so it is never a
  silent filter.
- **Should provider scope be escapable?** If typing `rocky` scopes to rocky, a
  user wanting a model literally named "rocky" on another host has no way
  through. An explicit escape, or scoping only when the match is also not a
  model-name match, needs deciding.
- **Does default-model selection need confirmation?** Resolving a provider row
  straight to a model is a hidden indirection the first time it happens. It may
  need to name the model it resolved to, rather than silently loading it.
- **Size ordering across mixed providers.** With no provider scope, a size sort
  would rank a 91 GB local model above every cloud model, which have no size at
  all. Ordering probably applies within a provider group, not globally.

## Impact

- `packages/tui/src/component/dialog-model.tsx` — query handling, ordering, and
  the row label.
- `packages/tui/src/local/` — reading `default` and `size_bytes` from the model
  list.
- No contract change. No llama-skein change.

## Incidental

`dialog-model.tsx:88-92` carries a comment saying `sizeBytes` "isn't in the
generated SDK type yet — read it loosely; regen the SDK to type it properly",
and reads it through `(model as { sizeBytes?: number })`. The regeneration has
since happened: `size_bytes` is in `packages/tui/src/local/llama-skein/gen/types.gen.ts:178`.
The cast and the comment can go.
