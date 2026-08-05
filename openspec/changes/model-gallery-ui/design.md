## Context

opencode-skein already provides:

- mDNS plus LAN discovery of llama-skein instances;
- automatic `/v1/models` discovery for OpenAI-compatible providers;
- generated llama-skein types/client;
- live `/api/fit` and `/api/hardware` use for local placement;
- model size/context enrichment and installed-model selection;
- native Solid web/desktop and terminal applications.

llama-skein already owns live hardware, storage, configured and running model
state, exact installed fit, pull/register, load/unload/remove, and current
llama-swap lifecycle behavior. Its hypothetical-fit worktree adds pre-download
fit. The companion `host-model-management-api` change makes long operations
reconnectable and contract-first.

llmfit is stronger in catalog richness, MoE/quant metadata, capability/use-case
classification, four-dimensional scoring, speed estimates, measured benchmark
overrides, plan/simulation UX, provider-to-artifact mappings, and shard-aware
downloads. Skein already has useful Hugging Face GGUF search, related-family
search, family/version upgrade classification, quant ranking, context-floor
selection, URL normalization, and CLI gallery tests.

The latest upstream opencode is materially ahead of the fork's merge base and
has redesigned V2 model selection/settings, improved model search, context
tooltips, and model-selection E2E coverage. Gallery UI work must extend those
new seams after an isolated merge, not deepen the old components.

## Goals / Non-Goals

**Goals:**

- make opencode-skein the complete cross-host model-management experience;
- work directly with discovered llama-skein hosts when Skein is stopped;
- adopt the best tested llmfit and Skein behavior without adding runtimes;
- keep catalog/ranking separate from provider inference resolution;
- expose evidence rather than one opaque recommendation score;
- preserve upstream opencode mergeability through additive modules and thin
  UI hooks;
- share one backend domain between web/desktop and terminal presentations.

**Non-Goals:**

- a Rust llmfit module, service, fork, submodule, or React runtime;
- duplicating llama-skein hardware, fit, file, or runtime state;
- making Skein proxy model-management traffic;
- automatic downloads, implicit eviction, or model replacement;
- implementing llmfit's provider adapters for Ollama/LM Studio/etc. in the
  first slice;
- claiming estimated speed or quality is measured.

## Decisions

### 1. Two-process architecture

```text
opencode-skein backend (TypeScript)
  catalog · HF search · cache · ranking · host aggregation
  web/desktop/TUI application API
                    |
                    | generated OpenAPI client
                    v
discovered llama-skein hosts (Go)
  hardware · storage · installed/runtime state · exact/hypothetical fit
  install operations · load/unload/remove
```

Skein is absent from the required path. It can later consume llama-skein fit
and inventory for autonomous Agent placement, but the gallery neither calls
nor waits for it.

### 2. Keep catalog logic inside the existing local-provider bounded context

Recommended backend layout, adjusted to existing Effect conventions:

```text
packages/opencode/src/local/
  catalog.ts             candidate sources, cache, normalization
  artifact.ts            immutable artifact-set and quant normalization
  gallery.ts             multi-host join and evidence ranking
  model-operation.ts     generated llama-skein operation adapter
  provenance.ts          adopted-source metadata
```

The existing `mdns.ts`, `sync.ts`, `placement.ts`, and generated
`llama-skein/` client remain separate concerns. Gallery logic MUST NOT be
placed in the already collision-prone upstream `provider/provider.ts`.

The local server group exposes typed endpoints used by both presentations:

- search/list candidates;
- candidate detail and exact variants;
- host inventory and fit matrix;
- recommendations with evidence;
- operation submit/get/cancel.

### 3. Use an explicit candidate and artifact model

```text
ModelCandidate
  id
  family/generation
  architecture
  params_total/active
  trained_context
  capabilities/use_cases/languages
  license/provenance/security
  quality/benchmark evidence
  variants[]

ModelVariant
  id
  format/backend
  quantization
  immutable repository/revision
  artifacts[] (path/role/size/digest)
```

Candidate identity is presentation/catalog identity. Variant artifact identity
is what is fitted and installed. Unknown metadata stays unknown; filename
heuristics never become verified facts.

### 4. Compose curated and live catalog sources

The catalog merges:

1. a reviewed seed converted from llmfit's model data, including source commit
   and MIT attribution;
2. live bounded Hugging Face searches;
3. explicit repository URLs supplied by the user;
4. optional local overlays for preferred or experimental models.

Hugging Face resolution pins a concrete revision and reads repository tree,
model card, config, and LFS/file metadata. Cache entries retain source,
freshness, ETag/revision, and stale state. Offline mode serves the reviewed
seed and stale cache explicitly.

An adoption manifest records every substantial llmfit/Skein source, upstream
commit, destination module, transformation, tests, and attribution. A periodic
scout reports upstream changes; it does not merge histories.

### 5. Adopt evidence dimensions, not llmfit's whole engine

Compatibility is a hard filter:

1. supported format/backend and complete artifact set;
2. license/security policy;
3. llama-skein hypothetical fit and required context;
4. host disk and availability.

Surviving variants are ordered using separately visible evidence:

- runtime fit and context headroom from llama-skein;
- quality/capability/use-case metadata derived from llmfit;
- measured throughput for sufficiently matching hardware when available;
- otherwise clearly labeled speed estimate;
- provenance and recency;
- downloads/likes only as discovery/popularity signals.

Portable llmfit formulas can be translated for browsing when a host is
offline, but never override a live llama-skein incompatibility.

### 6. Selectively adopt source implementations

From llmfit:

- adopt catalog schema ideas, GGUF sources, total/active MoE parameters,
  capabilities, use cases, licenses, quant bpp/quality/speed mappings,
  generation quality, KV alternatives, measured-vs-estimated speed, plan
  comparison, filters, installed indicators, and shard-set tests;
- port browse/detail/filter/compare/download/plan interactions into Solid;
- defer llmfit hardware detection, provider adapters, REST server, MCP, Rust
  TUI, benchmark submission, and hardware-upgrade simulator until separately
  justified.

From Skein:

- port bounded top/related Hugging Face search, installed-family keyword
  extraction, upgrade/fresh classification, quant ranking, context-floor
  selection, and their golden tests to TypeScript;
- port robust Hugging Face URL normalization to llama-skein's Go host boundary;
- do not retain Skein config/host assumptions or its size-only fit estimate.

### 7. Build on current upstream opencode UI

First merge upstream through `bun run sync-upstream` in a dedicated worktree.
The current upstream model surfaces to reuse include:

- V2 model selector/controller and improved search behavior;
- V2 model settings list and provider grouping;
- model context tooltip;
- model-selection user-story E2E.

The primary experience extends V2 Model Settings:

```text
Models
  Installed     current discovered models and host/runtime state
  Discover      curated/live gallery
  Operations    active and recent host operations
```

The session model picker gains a thin “Browse models…” action and recommended
installed indicators, not the entire gallery. The TUI provides the same
Installed/Discover/Operations concepts in compact form.

### 8. Present a host-aware workflow

1. Search or paste a Hugging Face repository.
2. Inspect candidate details and exact variants.
3. Select required task/capability/context filters.
4. Compare variants across all discovered hosts.
5. Choose a host and immutable install plan.
6. Confirm source, revision, artifacts, total bytes, license, disk, and
   expected fit.
7. Observe/cancel/reconnect to llama-skein operation.
8. Refresh inventory and select the registered model without restarting.

Loaded models, busy capacity, and potential eviction are visible before load.
No operation silently unloads a different model.

### 9. Degrade by capability and source

- Hugging Face unavailable: reviewed seed and stale cache remain browsable.
- One host unavailable: its state is stale/offline; other hosts remain usable.
- Hypothetical fit unavailable: that host is unknown, not no-fit.
- Host operation API unavailable: browse/fit remain read-only.
- Skein unavailable: no effect.

### 10. Keep upstream maintenance explicit

The fork manifest records additive directories and unavoidable hooks in local
routes, V2 settings, model selector, command registration, and TUI navigation.
Every upstream merge validates local discovery, generated client, placement,
gallery, and model-selection E2E.

Generic improvements to provider discovery or model UI extension seams should
be proposed upstream. Skein-specific behavior remains isolated.

## Risks / Trade-offs

- **Catalog logic in TypeScript duplicates some Go parsing.** → Keep the host
  trust boundary in llama-skein; TypeScript owns only discovery/presentation
  normalization.
- **llmfit data can drift.** → Pin adoption commits, automate change reports,
  and require reviewed generated diffs.
- **Popularity can reward poor community quants.** → Treat it only as a search
  signal after compatibility/provenance filters.
- **A huge upstream opencode merge can invalidate UI assumptions.** → Merge
  before feature work and target the resulting V2 APIs.
- **Many cross-host requests can slow search.** → Cache catalog resolution,
  bound concurrency/timeouts, progressively render host results, and cancel
  superseded searches.
- **Portable benchmark matches can mislead.** → Show measured only for strict
  comparable hardware/runtime metadata; label every estimate.
- **Operation proxy state can become stale.** → llama-skein owns operation
  truth; opencode stores only IDs and refreshes on focus/reconnect.

## Migration Plan

1. Merge current upstream opencode in the existing isolated worktree flow and
   pass fork-owned provider/model tests.
2. Merge hypothetical fit and host model-management contracts in llama-skein;
   regenerate opencode-skein client.
3. Add the adoption manifest, candidate/artifact types, reviewed seed, cache,
   and one explicit-repository resolver.
4. Deliver one-candidate/one-host read-only fit slice in V2 Model Settings.
5. Add all-host aggregation, filters, evidence ranking, and installed/upgrade
   classification.
6. Add host operations and the Operations view.
7. Add compact TUI support and picker entry points.
8. Reach parity with Skein's gallery/URL/pull behavior, then remove duplicate
   Skein model-management surfaces.
9. Add measured benchmark ingestion and advanced planning only after the core
   lifecycle is reliable.

Feature flags can hide Discover/Operations while preserving installed-model
selection. No model files or llama-skein configuration are rolled back by
disabling the UI.

## Open Questions

- Should the reviewed seed be generated directly from llmfit data or curated
  into a smaller coding-focused subset?
- Which benchmark hardware/runtime fields define a sufficiently comparable
  measured throughput result?
- Should explicit user overlays live in global opencode config or a separate
  cache/catalog file?
- When should MLX artifact discovery enter scope relative to GGUF-first
  delivery?
