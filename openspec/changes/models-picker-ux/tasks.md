# Tasks: Model Picker and VRAM Display Correctness

## 1. Size survives filtering

- [ ] 1.1 Add a distinct provenance field to the dialog option type in `packages/tui/src/ui/dialog-select.tsx` so a flattened, filtered row can show its group without consuming the footer slot. Verify: type-checks (`bun run typecheck` or the repo's configured check).
- [ ] 1.2 Change the render at `dialog-select.tsx:616` from `footer={flatten() ? (option.category ?? option.footer) : option.footer}` so that footer always renders `option.footer` and provenance renders in the new field when `flatten()` is true. Keep `flatten()` (`:179`) and its purpose intact. Verify: with `flat={true}` and a non-empty filter, both size and group render.
- [ ] 1.3 `packages/tui/src/component/dialog-model.tsx`: populate the new provenance field with the provider name (currently passed as `category` at `:92`) and leave `footer: formatModelSize(info.sizeBytes)` at `:55` and `:95` unchanged. Verify: browse a provider, type a filter, confirm sizes remain visible — this is the reported bug.
- [ ] 1.4 Regression test covering the exact defect: a flattened list with a non-empty filter renders both size and provenance. Verify: the test fails against the current `:616` expression and passes after 1.2.
- [ ] 1.5 Confirm no regression to recents/favorites, which render only when the query is empty (`dialog-model.tsx:32,37`). Verify: open the picker with no query, sizes render as before.

## 2. Fit-based recommendation

- [ ] 2.1 Add a client call for the target provider's fit report (`/api/fit`), returning fit level, model size, VRAM total, max safe context, and estimated tok/s. Cache per provider for the dialog's lifetime; never block dialog open on it. Verify: the dialog opens at current speed with the endpoint unreachable.
- [ ] 2.2 Annotate rows with fit level and visibly mark models that cannot fit. Verify: against a provider with known VRAM, a too-large model is marked and a fitting one is not.
- [ ] 2.3 Mark one recommended model per provider. Define and document the rule (largest model whose fit level is acceptable at the configured context). Verify: the rule is stated in the change notes and the marked model matches it.
- [ ] 2.4 Degrade cleanly: with no or stale fit data, render the unannotated list and keep selection working. Verify: with the endpoint stubbed to fail, the picker is fully usable.
- [ ] 2.5 Treat max safe context as advisory — llama-skein `bound-max-safe-ctx` exists because it has advertised unachievable values. Verify: the recommendation does not present it as a guarantee.

## 3. VRAM bar tracks the model

- [ ] 3.1 `packages/tui/src/feature-plugins/sidebar/context.tsx:186`: widen `hardwareBaseURL` to a composite string key of base URL and model identity (for example `` `${state().baseURL}|${state().modelID}` ``). It must stay a **string-equality** memo — the comment at `:184` records that keying on `state()` restarts the poll every stream tick. Verify: type-checks; the memo returns a string.
- [ ] 3.2 Confirm the existing effect (`:188-227`) now re-runs on model switch, so `setMem(null)` / `setTuning(null)` (`:191`) fire and a fresh sample is fetched immediately instead of waiting for the 30 s `setInterval` (`:220`). Verify: switch model on one provider and confirm the VRAM bar and `MemBreakdown` (`:125-140`) update promptly rather than showing the prior model's `model_mb` / `kv_estimate_mb` (`:47-48`).
- [ ] 3.3 Confirm no poll restart on stream ticks with unchanged provider and model. Verify: instrument or test that the effect body runs once across many state updates.
- [ ] 3.4 Confirm provider switching still behaves as before. Verify: switch provider, confirm reset-and-refetch is unchanged.

## 4. Close the size-clobbering footgun

- [ ] 4.1 `packages/opencode/src/provider/provider.ts:1452-1456`: `mergeDiscoveredModel` spreads `...existing` over `...discovered`, so an existing entry with `sizeBytes: undefined` would overwrite a discovered size. Make the merge preserve the discovered value when the existing one is absent or undefined. Note this is prevention — `local/sync.ts` writes no `models` key today, so nothing triggers it. Verify: unit test merging an existing entry with undefined size against a discovered entry with a real size retains the real size.

## 5. Verification

- [ ] 5.1 Repo typecheck, lint, and test suites clean, with only pre-existing baseline failures. Record the baseline diff in task notes.
- [ ] 5.2 Manual pass against a live provider: (a) browse models, type a filter, sizes remain visible; (b) an oversized model is marked as not fitting and one model is recommended; (c) switching model within one provider updates the VRAM bar promptly; (d) switching provider still resets correctly. Record observations in task notes.
