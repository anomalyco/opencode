## Why

opencode-skein already discovers every local llama-skein host and enriches its
installed models with live fit data. Users still have to leave the workspace,
search Hugging Face manually, guess a quant, and discover after a large
download whether it fits.

The gallery should be a native opencode-skein capability backed directly by
llama-skein. llmfit and Skein contain valuable implementation and UX ideas,
but neither should be a runtime dependency.

## What Changes

- Add a TypeScript local-model catalog with curated llmfit-derived metadata,
  live Hugging Face search, exact revision/artifact normalization, caching,
  and provenance.
- Aggregate candidate × discovered llama-skein host × artifact fit through the
  generated hypothetical-fit client.
- Rank only after hard compatibility checks, with separately explained fit,
  context, quality, speed/benchmark, capability, provenance, and popularity
  evidence.
- Add native Solid web/desktop model discovery and management on top of the
  latest upstream V2 model settings/selector surfaces.
- Add a compact terminal gallery using the same opencode backend domain/API.
- Manage install/load/unload/remove directly through llama-skein's generated
  host-operation contract, including reconnectable progress and cancellation.
- Port useful llmfit UI workflows and selected MIT-licensed algorithms/data
  with attribution; do not add Rust or React.
- Port useful Skein gallery behavior, then remove the duplicate Skein gallery
  ownership after parity.
- Merge current upstream opencode through the existing isolated worktree flow
  before adding gallery UI integration points.

## Capabilities

### New Capabilities

- `local-model-gallery`: Catalog discovery, multi-host fit comparison,
  recommendations, and explicit host model management inside opencode-skein.

### Modified Capabilities

None.

## Impact

- `packages/opencode/src/local` domain services and local HTTP API.
- generated llama-skein TypeScript client.
- `packages/app` V2 model settings, picker, and gallery components.
- `packages/tui` model browsing and operation progress.
- local cache/provenance data imported from llmfit.
- removal or migration of duplicate Skein model gallery commands.
- no runtime dependency on Skein, llmfit, Rust, or React.
