# Model Picker and VRAM Display Correctness

## Why

Choosing a local model is the most consequential decision in a session — an undersized model wastes the run, an oversized one wedges the provider — and the TUI actively misinforms that choice in three ways.

**1. Model size disappears exactly when you are choosing.** `dialog-model.tsx:55` (recents/favorites) and `dialog-model.tsx:95` (provider browsing) both set `footer: formatModelSize(info.sizeBytes)`, so the data is present in both branches. But `dialog-select.tsx:616` renders

```
footer={flatten() ? (option.category ?? option.footer) : option.footer}
```

and `flatten()` (`dialog-select.tsx:179`) is `props.flat && store.filter.length > 0`, with `DialogModel` passing `flat={true}` (`dialog-model.tsx:203`). **The moment you type a filter, the GB footer is replaced by `option.category`** — which for provider-browse rows is the provider name (`dialog-model.tsx:92`). Recents keep their size only because that view renders only when the query is empty (`dialog-model.tsx:32,37`). That is precisely the reported asymmetry: sizes "only show for recently used". They show for everything, until you type.

**2. There is no recommendation.** Nothing tells you which model actually fits the target provider. The data to answer it already exists — llama-skein's `/api/fit` returns `fit_level`, `model_mb`, `vram_total_mb`, `max_safe_ctx`, and an estimated tok/s — but the picker does not consult it.

**3. The VRAM bar lies after a model switch.** `sidebar/context.tsx:186` memoizes on `state().baseURL` alone, and the poll effect (`:188-227`) keys on that memo. Switching model *within* one provider leaves `baseURL` unchanged, so the effect never re-runs, the `setMem(null)` reset at `:191` never fires, and the bar keeps rendering the previous model's `model_mb` / `kv_estimate_mb` (`:47-48`) until the 30-second `setInterval` (`:220`) happens to refresh it.

The string-equality memo is deliberate — its comment explains that keying on `state()` directly would restart the poll on every stream tick. So the fix is to widen the key, not remove it.

Neither bug is filed. Nine near-duplicate "context management" proposals touched this sidebar and all were rejected without naming either defect.

## What Changes

- **Size survives filtering.** The footer slot stops being overloaded. `flatten()` exists so that a flattened, filtered list still shows which group a row came from; that provenance moves to a distinct field rather than displacing the footer, so size and provenance coexist.
- **A fit-aware recommendation.** The picker annotates each model with its fit against the target provider, sourced from `/api/fit`, and marks a recommended choice. Models that cannot fit are visibly marked rather than silently offered. Absent or stale fit data degrades to today's unannotated list rather than blocking the picker.
- **The VRAM bar tracks the model.** The hardware poll key widens from `baseURL` to `baseURL` + model identity, preserving the string-equality property that keeps stream ticks from restarting the poll. On a model switch the stale sample is dropped immediately and a fresh sample is fetched, rather than waiting up to 30 s.
- **A latent size-clobbering footgun is closed.** `mergeDiscoveredModel` (`provider.ts:1452-1456`) spreads `...existing` over `...discovered`, so a config-declared model entry carrying an explicit `sizeBytes: undefined` would overwrite a freshly discovered size. Nothing writes such an entry today (`local/sync.ts` writes no `models` key), so this is prevention, not a live bug.

## Capabilities

### New Capabilities
- `models-picker-ux`: size visibility independent of filter state, fit-based recommendation in the picker, and model-keyed hardware polling.

### Modified Capabilities
<!-- none -->

## Non-Goals

- No change to model discovery or to the `/v1/models` client. `sizeBytes` already arrives correctly (`provider.ts:1532`, schema `:1114`).
- No new fit engine. This consumes llama-skein's `/api/fit`; it does not compute fit locally.
- No redesign of the dialog component. `flatten()` keeps its purpose; only the overloaded footer slot is separated.

## Impact

- `packages/tui/src/ui/dialog-select.tsx:179,616` — separate provenance from footer so both render.
- `packages/tui/src/component/dialog-model.tsx:32,37,55,92,95,203` — supply provenance in its own field; add the fit annotation and recommended marker.
- `packages/tui/src/feature-plugins/sidebar/context.tsx:186,188-227` — widen the poll key to include model identity; keep the string-equality memo.
- `packages/opencode/src/provider/provider.ts:1452-1456` — do not let an undefined `sizeBytes` in an existing entry clobber a discovered one.
- Consumes llama-skein `/api/fit`. Related: llama-skein `add-model-size` (`size_bytes` on `/v1/models`) and `bound-max-safe-ctx` (stops `/api/fit` advertising an unachievable `max_safe_ctx`) — the recommendation is only as good as the latter, so it should land first or the recommendation must treat `max_safe_ctx` as advisory.
