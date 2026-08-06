## 1. Upstream and fork baseline

- [ ] 1.1 Run the existing opencode upstream sync in a dedicated worktree and
      merge current `upstream/dev`; do not rebase the long-lived fork.
- [ ] 1.2 Resolve and validate the V2 model selector, settings, search,
      context-tooltip, provider-connect, and model-selection E2E surfaces.
- [ ] 1.3 Update the fork manifest with gallery-owned modules and thin hooks in
      local routes, settings, picker, commands, and TUI navigation.
- [ ] 1.4 Verify llama-skein is based on current llama-swap lifecycle/routing
      behavior and record supported host contract capabilities.

## 2. Source adoption and provenance

- [x] 2.1 Add an adoption manifest for llmfit and Skein source commits,
      destination modules, transformations, tests, and MIT attribution.
- [ ] 2.2 Build a reviewed importer for selected llmfit catalog fields and
      emit deterministic TypeScript/JSON data.
- [ ] 2.3 Port llmfit quant bpp/quality/speed mappings, capability/use-case,
      generation, MoE active-parameter, and GGUF-source tests needed by the first
      slice.
- [ ] 2.4 Port Skein quant parsing/ranking, installed-family keyword
      extraction, upgrade/fresh classification, and context-floor tests.
- [ ] 2.5 Add a scout command that reports relevant upstream llmfit catalog,
      benchmark, algorithm, and UI changes without merging repository histories.

## 3. Generated host contract

- [x] 3.1 Merge/regenerate the llama-skein hypothetical-fit contract and
      replace handwritten fit response types where generated types exist.
- [x] 3.2 Regenerate the host-model-management operation client after its
      OpenAPI change lands. Regenerated from
      `llama-skein/contracts/llama-skein.openapi.json` via
      `bun run build:llama-skein-client`. llama-skein's
      host-model-management-api sections 1-5 are merged, so the operation
      surface is now generated rather than handwritten:
      `createModelOperation`, `getModelOperation`, `listModelOperations`,
      `cancelModelOperation`, `streamModelOperationEvents`, alongside the
      config-model CRUD and `postHypotheticalFit`.
      The regeneration diff is 20 lines in `types.gen.ts` and nothing in
      `sdk.gen.ts` — the operation *methods* were already generated from an
      earlier contract; what had drifted were the provenance fields
      llama-skein's task 5.1 added to `Model` (`installed`,
      `source_repository`, `source_revision`, `artifact_paths`,
      `active_operation_id`). Those are exactly what an Installed view needs to
      distinguish "configured" from "actually on disk" and to reattach to an
      install still in flight, so the client was quietly missing the fields
      section 7 depends on.
      `bun run typecheck` clean; `bun test test/local/` 189 pass.
- [ ] 3.3 Add capability negotiation for hypothetical fit, inventory detail,
      install operations, cancellation, and event observation.
- [ ] 3.4 Preserve existing installed-model discovery and inference against
      older/non-llama-skein providers.

## 4. Catalog domain

- [x] 4.1 Define candidate, variant, artifact set, provenance, evidence,
      policy, freshness, and unknown-field schemas.
- [x] 4.2 Implement reviewed seed loading, deterministic merge precedence, and
      local overlays.
- [x] 4.3 Implement bounded Hugging Face search plus explicit repository
      resolution at an immutable revision.
- [x] 4.4 Resolve model card, config, repository tree, LFS sizes/digests,
      license, task tags, architecture, total/active params, context, quants,
      shards, and auxiliary files.
- [x] 4.5 Implement ETag/revision-aware cache, TTL, offline seed fallback, and
      explicit stale status.
- [x] 4.6 Add policy filters for unsupported formats, gated repos, licenses,
      missing sizes, incomplete shards, ambiguous quants, and provenance.

## 5. Multi-host gallery

- [x] 5.1 Reuse discovered llama-skein identities/base URLs rather than
      introducing a second discovery mechanism.
      `src/local/model-gallery/hosts.ts` is a projection of `scanLlamaSwap`,
      not a parallel implementation — a second mechanism would drift from the
      first and show the user a gallery listing different hosts than the
      provider picker on the same screen. What it does add is a stable join
      key (`hostId`, the normalized base URL), because 5.3 joins across async
      calls and neither mDNS names nor reverse-DNS names are usable as keys.
      Offline hosts are retained rather than filtered: 5.6 has to say "that
      host is offline", which dropping the host would make indistinguishable
      from the host never existing. Duplicate discoveries of one endpoint
      collapse, preferring the entry that actually answered.
- [x] 5.2 Batch each candidate's exact variants through bounded concurrent
      hypothetical-fit calls to all compatible hosts.
      `src/local/model-gallery/fit.ts`. Batching is free because llama-skein's
      hypothetical-fit endpoint already takes a variant list, so one request
      carries every quantization of one candidate: request count is
      (candidates x hosts), not (candidates x variants x hosts) — 100 requests
      instead of 600 for a 20-candidate gallery over 5 hosts with 6 quants.
      Concurrency is capped (default 4) because these are the user's actual
      GPUs, possibly mid-inference; the gallery is a background nicety and must
      never be why a chat stalls. Offline hosts are skipped rather than
      attempted, so a dead host costs one discovery probe instead of one
      timeout per candidate.
      Every failure mode — offline, timeout, older build without the endpoint,
      reshaped response — collapses to `answered: false`, never to a negative
      verdict. Responses are read defensively field by field, because the
      gallery talks to whatever llama-skein build the user happens to run and a
      missing field must not throw and take the whole fan-out with it.
- [x] 5.3 Join inventory, runtime state, hardware/storage, fit, and candidate
      evidence by stable host/variant identity.
      `src/local/model-gallery/join.ts` emits one row per (candidate, host)
      keyed on `hostId` + `candidateId`, including pairs where a source is
      missing — the absence is the signal 5.6 classifies on, so dropping those
      pairs would erase it. Capacity is indexed through the same host-id
      normalization, since a trailing slash would otherwise silently lose every
      busy signal.
      An unreachable capacity probe leaves `busy` undefined rather than false:
      "idle" and "we have no idea" must not be the same value, or a scheduler
      reads an unreachable host as free and dispatches into a hole. Row order
      is stable and deliberately unranked — ranking is 5.5, and a join that
      quietly sorted by desirability would make that untestable in isolation.
      20 tests in `test/local/model-gallery-dataplane.test.ts`; `bun run
      typecheck` clean; `bun test test/local/` 209 pass.
- [x] 5.4 Implement hard compatibility filters before ranking.
      `src/local/model-gallery/filter.ts`. "Hard" means disqualifying fact, not
      preference: a model that cannot run on a host is not a low-scoring
      option, it is not an option. Two reasons it must precede ranking —
      ranking weights are tuned against plausible options, so impossible ones
      distort every relative score around them; and "ranked last" and "cannot
      run" look identical in a sorted list, so a user scrolling to the bottom
      sees a suggestion the machine cannot honour.
      An UNKNOWN fit deliberately does not disqualify. Filtering there would
      hide a perfectly good model because a host runs an older llama-swap
      build, and the user could not tell that apart from the model not
      existing; 5.6 labels it instead. All applicable reasons are collected
      rather than short-circuiting, since naming one of three problems invites
      the user to fix it and find the pair still unavailable.
- [x] 5.5 Implement explained fit/context, quality, speed/benchmark,
      capability, provenance, recency, and popularity evidence.
      `src/local/model-gallery/rank.ts`. "Explained" does the work here: a
      single number tells the user nothing actionable, because they cannot
      tell a model that ranked low for barely fitting from one that ranked low
      for being unpopular — and those call for opposite responses. Scoring
      therefore emits named, signed contributions whose sum IS the total, so
      the UI can show the total, the top contributor, or the full breakdown
      and none can drift from the others.
      All seven dimensions are covered, reusing existing vocabulary rather
      than inventing a parallel one: `ModelEvidence.kind` gained "provenance"
      and "recency" (backward compatible — existing emitters are untouched),
      and quality/speed come from llmfit's tables in `quant.ts`, keyed on the
      variant that would actually be installed rather than the candidate in
      the abstract. Compatibility and context outrank popularity, as the
      proposal requires; an unverifiable fit scores below a verified one
      (a penalty for being unverifiable, not for being bad); context headroom
      beyond the request earns no extra credit; and recency uses an injected
      clock so tests are not time-dependent.
- [x] 5.6 Add installed, upgrade, fresh, stale, offline, unsupported, and
      unknown classifications.
      `src/local/model-gallery/classify.ts`. Each row gets exactly one label
      because the UI shows one badge; the substance is the PRECEDENCE, since
      several are true at once for most rows and picking the wrong one tells
      the user to fix the wrong thing. Order is most-fundamental-first, the
      same principle Skein's placement port uses: offline > unsupported >
      installed > unknown > stale > upgrade/fresh. A down host is also
      technically "nothing fits" and "not installed", and reporting either
      sends the user after a model problem they do not have.
      "unknown" deliberately outranks "stale" and the family labels: claiming
      a fresh find on a host we could not query is an invention, whereas
      admitting we do not know is always true. Upgrade detection reuses
      `model-catalog/family`'s version parsing rather than reimplementing it,
      so the gallery and catalog cannot disagree — including the two Skein
      defects deliberately fixed there.
      27 tests in `test/local/model-gallery-ranking.test.ts`; `bun run
      typecheck` clean; `bun test test/local/` 236 pass.
- [ ] 5.7 Expose typed local HTTP API endpoints shared by app and TUI.

## 6. Web and desktop experience

- [ ] 6.1 Extend current upstream V2 Model Settings with Installed, Discover,
      and Operations sections.
- [ ] 6.2 Implement gallery search, filters, candidate cards/table, empty,
      offline, stale, and progressive host-result states.
- [ ] 6.3 Implement candidate detail with model card link, provenance,
      license, capabilities, exact artifacts, quants, context, quality, and speed.
- [ ] 6.4 Implement host comparison with fit/context, disk, loaded/busy state,
      expected eviction, and evidence explanations.
- [ ] 6.5 Port useful llmfit browse/filter/detail/compare/plan/download
      interactions into native Solid components with attribution.
- [ ] 6.6 Add “Browse models…” to the V2 session picker without embedding the
      complete gallery in the picker.

## 7. Host operations

- [ ] 7.1 Build immutable install plans and require confirmation of host,
      revision, artifacts, bytes, license, disk, and expected fit.
- [ ] 7.2 Submit, observe, cancel, and reconnect to llama-skein operations by
      ID without making opencode the operation authority.
- [ ] 7.3 Implement Operations UI with aggregate/per-artifact progress,
      terminal outcomes, warnings, retry/resume, and actionable errors.
- [ ] 7.4 Refresh provider inventory/model picker after registration without
      application restart.
- [ ] 7.5 Add explicit load, unload, and remove flows with affected-model and
      eviction confirmation.

## 8. Terminal experience

- [ ] 8.1 Add compact Installed, Discover, and Operations views using the same
      backend API and evidence vocabulary.
- [ ] 8.2 Add search, task/capability/context/host filters and per-host fit
      badges.
- [ ] 8.3 Add install confirmation, progress, cancellation, and failure
      rendering.
- [ ] 8.4 Preserve the normal installed-model picker when gallery capabilities
      are unavailable.

## 9. Skein parity and retirement

- [ ] 9.1 Add golden parity tests for Skein's current HF search, quant,
      context-floor, family-upgrade, URL, and pull-selection behavior.
- [ ] 9.2 Port any still-superior behavior to opencode-skein or llama-skein at
      the owning boundary.
- [ ] 9.3 Migrate Skein's autonomous placement caller to generated
      llama-skein contracts where still required.
- [ ] 9.4 Remove duplicate Skein gallery/recommend/pull presentation after
      opencode web/TUI parity and end-to-end validation.

## 10. Verification

- [ ] 10.1 Contract tests across current and older llama-skein capabilities.
- [ ] 10.2 Catalog tests for deterministic merge, cache, revision pinning,
      metadata inference, shards, auxiliaries, policy, and offline behavior.
- [ ] 10.3 Ranking tests proving compatibility/context outrank popularity and
      portable estimates cannot override runtime no-fit.
- [ ] 10.4 App component and E2E tests for search, detail, host comparison,
      operations, reconnect, cancellation, and picker refresh.
- [ ] 10.5 TUI tests for the same state matrix.
- [ ] 10.6 Regression test installed-model chat with Hugging Face and Skein
      unavailable.
- [ ] 10.7 Live end-to-end on CUDA/ROCm and Apple hosts: explicit repo →
      compare → install/resume → verify → load → use in an existing session.
