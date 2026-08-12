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

llmfit's sister projects, `llmserve` and `llama-panel`, were also inspected
(source read directly, not just documentation). Both are strictly
single-machine: neither has mDNS, a fleet concept, or any notion of comparing
the same model across more than one host. `llmserve`'s three-panel TUI
(Sources / Models / Serve+Logs) and its serve dialog (backend picker, port,
live log tail) are a relevant *interaction* reference for the terminal
Operations view. `llama-panel`'s end-to-end flow (HF search → quant/shard
picker with sizes → download progress with ETA → per-server tuning →
playground) is a relevant reference for the web Discover/Operations views —
it maps closely to what the generated `ModelOperation` progress stream
already carries. Its "OpenCode integration" is a ~20-line Tauri command that
patches `~/.config/opencode/opencode.json` with one hardcoded
`http://127.0.0.1:<port>/v1` provider entry; `local.connect` (fed by mDNS
across the whole fleet) is already a strict superset of it, so there is
nothing there to avoid re-implementing.

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

From llmserve (interaction pattern only — no source is MIT-compatible-adopted,
it is UX reference):

- the Sources/Models/Serve+Logs panel split and its serve confirmation dialog
  (pick backend, pick port, see live log tail) for the terminal Operations
  view;
- per-backend preset shape (ctx size, batch size, GPU layers, extra args) as a
  precedent for how host-side flags could be previewed before an install plan
  is confirmed.

From llama-panel (interaction pattern only, same reason):

- download progress with ETA and a persistent history list, for the web
  Operations view built on the generated `ModelOperation` progress stream;
- the quant/shard file picker showing per-variant size, for candidate detail;
- do not adopt its single-process server-spawn/ownership model — that is
  llama-skein's job across a fleet, not a UI concern.

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

### 11. Distribution: build fork-native now; plugin distribution deferred

**Decided 2026-08-12**: sections 6-8 ship as fork modules per decisions 1-10,
unchanged. Plugin distribution is not adopted for this change. Reasons:

- adoption risk is real, not hypothetical — plugins exist in this exact
  codebase (`specs/tui-plugins.md`, an in-TUI plugin manager) and the
  person shipping this feature has never installed one. A gallery nobody
  opens because it needed an opt-in install step is worse than one that
  costs a rebase hook;
- the fork's custom-surface discipline (`fork/manifest.json`,
  `bun run fork:verify`) already exists, is tooled, and — as of a
  2026-08-12 audit — is now accurate (11/11 owned, 18/18 patched, zero
  outstanding regressions). The upstream gap is 22 commits, not a wall.
  Fork maintenance cost is real but currently small and known, not the
  crisis it can feel like from inside a stalled rebase attempt;
- sequencing: `model-gallery-ui` task 1.1 (upstream sync) is explicitly
  deferred for now (see project notes), so nothing in sections 6-8 can
  start before that regardless of distribution model. Deciding fork-vs-plugin
  today would be deciding ahead of information a working implementation
  would surface anyway.

The analysis below is kept as a reference for *if this is revisited later*
— e.g., if the fork's fork:verify-tracked patch count keeps growing, or if
a second, non-opencode-skein consumer of the same fleet-gallery logic shows
up and a plugin's independent versioning becomes worth the adoption cost.
It is not a plan of record.

**What a TUI plugin can actually do**, read from
`specs/tui-plugins.md` and `packages/plugin/src/index.ts`:

- a `tui` target gets `api.route.register` (full-screen routes),
  `api.ui.Dialog*`/`ui.dialog` (modal stack), `api.keymap.registerLayer`
  (commands + bindings + command palette), `api.kv`, `api.state`
  (live host state), and `api.client` (the runtime SDK client) — enough to
  build the entire Discover/Installed/Operations experience as plugin routes
  instead of new `packages/tui` modules;
- a `server` target gets declarative `Hooks`: `config`, `provider.models`
  (supply/enrich a provider's model list at call time), `tool`, plus the
  chat/tool/permission lifecycle hooks — there is no hook to register an
  arbitrary new REST endpoint like `local`/`gallery`'s `HttpApiBuilder.group`;
- `server` and `tui` must be separate module exports (`./server` /
  `./tui`) but can ship in one npm package, installable from `tui.json` or
  the in-TUI plugin manager, versioned independently of the fork.

**What this means for the three kinds of logic this change touches:**

1. **Discovery and fit fan-out** (`mdns.ts`, `model-gallery/{hosts,fit,join,
   filter,rank,classify,catalog}.ts`) — plain async TypeScript with no
   dependency on Effect, `HttpApiBuilder`, or any opencode server internal.
   The `local`/`gallery` HttpApi groups exist only so the web frontend can
   reach this logic over HTTP; a TUI plugin runs in the same Bun/Node process
   and could call these functions directly, or scan/fit-compute independently
   of whether the fork's HTTP groups exist at all. **Portable to a plugin
   with no loss of fleet-awareness** — this is exactly the "multi local API
   provider" capability neither llmfit nor llama-panel has, and nothing about
   a plugin boundary weakens it.
2. **TUI presentation** (Discover/Installed/Operations views, the
   llmfit-inspired ranked/filterable table, llmserve/llama-panel-inspired
   serve dialog and progress UI) — buildable entirely as plugin routes/dialogs
   per the API surface above. A plugin here means gallery UI work stops
   needing `bun run sync-upstream` worktree merges against `packages/tui`
   entirely, which is the direct answer to the "easier to maintain" concern:
   it is not fork code, so it cannot go stale against upstream TUI refactors.
3. **Provider registration** — `local.connect`/`disconnect` currently
   read-modify-write `opencode.json` on disk. `Hooks.provider.models` and/or
   `Hooks.config` may let a plugin supply discovered llama-skein hosts as
   live providers without ever touching the config file — **unverified**:
   it is not confirmed from the type signatures alone whether these hooks
   re-run per-request/per-config-read or only once at startup. Needs a
   throwaway spike before this replaces `local.connect`, not an assumption.

**What plugins cannot reach**, and why the fork still owns some of this
regardless of the outcome above:

- `provider.ts`'s prompt-overflow/`context_too_large` interception (the
  actual 413 retry-with-patched-`ctx_size` logic) is wired into opencode's
  model-resolution/streaming pipeline at a point no exposed `Hooks` entry
  covers (`chat.params`/`chat.headers` run before the request, not on a
  fetch-level error);
- the generated llama-skein Go/TS client *generation step*
  (`bun run build:llama-skein-client`) is fork tooling; a plugin would import
  or vendor the generated types as a dependency, not regenerate them itself;
- anything that must be visible to both the web app and a plugin-less TUI
  (a user who never installs the gallery plugin) needs a fork-level fallback,
  per decision 9's degrade-by-capability requirement.

**Net effect if adopted**: decisions 2, 7, and 8 would change from "new
`src/local/` modules + `packages/tui` additions" to "a `@opencode-skein`
(or similarly named) plugin package depending on the generated llama-skein
client, with only provider-registration and the prompt-overflow interception
remaining fork-only." Decisions 3-6, 9, and 10 are distribution-agnostic and
would not change. This also reopens whether such a plugin should be
llama-skein-specific or generalized enough to work against any llama-skein-
compatible fleet — a broader question than this change needs to answer now.

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
- Decision 11 is resolved for this change (fork-native, plugin deferred).
  Kept as an open question only for a *future* revisit trigger: if or when
  the fork's `patched` count or upstream drift grows enough that plugin
  distribution's independent-versioning benefit outweighs the adoption-risk
  cost above, or a second consumer of the fleet-gallery logic appears.
- Do `Hooks.config`/`Hooks.provider.models` re-evaluate live, or only once at
  plugin activation? Unverified either way — not worth spiking now that
  decision 11 is deferred, but relevant background for that future revisit.
- If gallery presentation ever becomes a plugin, does `provider.ts`'s
  prompt-overflow interception need a new exposed hook upstream, or does it
  permanently stay fork-only regardless of where the rest of the gallery
  lives?
