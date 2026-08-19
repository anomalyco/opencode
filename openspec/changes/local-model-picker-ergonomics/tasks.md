# Tasks: Local model picker ergonomics

## 1. Resolve the open questions first

These change the design, not the implementation, so answer them before writing code.

- [ ] 1.1 Decide the provider-match rule (exact / unique-prefix / other) and how the
      active scope is shown, so it is never a silent filter. Check the real provider
      names in use — `rocky`, `z4`, `m3`, `m5`, `proxmox` — for prefix collisions.
      Validation: rule written down with the collision cases it rejects.
- [ ] 1.2 Decide whether provider scope is escapable, and how, for the case of a model
      whose own name matches a provider name.
      Validation: a stated behaviour for query `rocky` when another provider hosts a
      model called `rocky-*`.
- [ ] 1.3 Decide whether resolving a provider to its default model announces the model
      it chose. Leaning yes — a hidden indirection is worse than one extra line.
- [ ] 1.4 Decide whether size ordering applies within a provider group only.
      A global size sort ranks every sized local model above every cloud model,
      which have no `size_bytes` at all.

## 2. Provider-scoped query

- [ ] 2.1 Detect a provider match per 1.1 before the fuzzysort pass in
      `dialog-model.tsx:174`, and when it fires, list that provider's models
      unranked-against-others instead of merging into the global result set.
- [ ] 2.2 Further typing narrows within the scope rather than re-running the global
      search. Validation: `rocky` then ` q5` reaches the Q5 model without leaving scope.
- [ ] 2.3 The active scope is visible and dismissable per 1.1/1.2.
      Validation: a test asserting the scope indicator appears for a provider query.

## 3. Default-model resolution

- [ ] 3.1 Read `default` from the model list (already in the generated types) and
      resolve a provider selection to that model.
      Validation: with a default set on rocky, selecting rocky loads it without a
      second keystroke.
- [ ] 3.2 A provider with no default expands to its model list — today's behaviour,
      unchanged. Validation: test covers both branches.
- [ ] 3.3 Verify against a live provider that `default` actually arrives in
      `/v1/models`. llama-skein documents it as "Listed first in the model list";
      confirm the flag rather than relying on position.
      Validation: recorded response from a provider with a default configured.

## 4. Ordering

- [ ] 4.1 Sort by `size_bytes` descending where the provider reports it; fall back to
      the existing `sortModelOptions` behaviour where it does not.
      Validation: rocky's list leads with the largest GGUF; a cloud provider's list is
      unchanged.
- [ ] 4.2 Keep alphabetical reachable. Whether that is a toggle or the fallback is a
      1.4 outcome. Validation: both orders demonstrated.

## 5. Row label

- [ ] 5.1 Render size and VRAM together as `19G/24GB`, with the hostname as the label
      (`19G/24GB rocky`). Replaces the split between `footer` (size) and `provenance`
      (`${name} · ${vram}`) at `dialog-model.tsx:59-62,92`.
- [ ] 5.2 Omit the VRAM half rather than substituting a placeholder when the host does
      not report it. Validation: a provider with no VRAM reading renders `19G rocky`.
- [ ] 5.3 Check the row still fits a narrow terminal; the combined token is longer than
      either half was. Validation: rendered at 80 columns.

## 6. Cleanup

- [ ] 6.1 Remove the `(model as { sizeBytes?: number })` cast and the stale comment at
      `dialog-model.tsx:88-92` claiming the field is not in the generated type. It is:
      `packages/tui/src/local/llama-skein/gen/types.gen.ts:178`.
      Validation: typecheck passes without the cast.

## 7. Verification

- [ ] 7.1 `bun run typecheck` in `packages/tui` — no new errors. Note the repo does not
      typecheck clean today; compare against a baseline rather than expecting zero.
- [ ] 7.2 Exercise against a live provider: scope to rocky, confirm size ordering
      matches `skein models list`, confirm the default resolves.
- [ ] 7.3 Confirm nothing changed for a cloud provider — ordering, labels, and search
      behaviour identical to before.
