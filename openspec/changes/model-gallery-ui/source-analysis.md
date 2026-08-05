# Source capability analysis

This analysis records what should be reused, translated, extended, or rejected
before implementation. It is planning evidence, not a runtime dependency map.

## Current opencode-skein

| Capability                       | Current strength                                       | Plan                                                                     |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| mDNS + LAN host discovery        | Already discovers and configures llama-skein instances | Reuse unchanged                                                          |
| Installed `/v1/models` discovery | Parallel, timeout-bounded, merges configured models    | Reuse; refresh after operations                                          |
| Live fit/hardware placement      | Already reads `/api/fit` and `/api/hardware`           | Extract gallery calls from upstream-hot `provider.ts` into local modules |
| Generated llama-skein client     | Present                                                | Regenerate for hypothetical fit and host operations                      |
| Model size/context display       | Present in fork                                        | Rebase on latest upstream tooltip/selector                               |
| Web model management             | Visibility toggles only                                | Extend latest V2 Settings with Installed/Discover/Operations             |
| TUI model selection              | Installed models only                                  | Add compact gallery and operations                                       |

## llmfit advantages

| Capability                 | Why it is better                                                                                            | Adoption                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Rich catalog model         | Architecture, total/active params, MoE, capabilities, use cases, languages, licenses, formats, GGUF sources | Translate selected schema/data into TypeScript             |
| Quant model                | bpp, speed multiplier, quality penalty, dynamic quant selection                                             | Translate mappings and golden tests                        |
| Multi-dimensional scores   | Fit, speed, quality, and context are separate and explainable                                               | Adopt evidence vocabulary; do not copy one opaque score    |
| Speed estimation           | Memory-bandwidth estimates with explicit assumptions                                                        | Adopt later as labeled estimate                            |
| Measured benchmarks        | Hardware-matched measurements override estimates                                                            | Adopt ingestion/index after core gallery                   |
| Planning                   | GPU/CPU/offload paths, KV alternatives, upgrade deltas                                                      | Port candidate/host plan UI selectively                    |
| Filters                    | Provider, license, capability, use case, format, fit                                                        | Adopt for gallery                                          |
| Installed mappings         | Normalizes runtime-specific installed names                                                                 | Use concepts; llama-skein inventory remains truth          |
| Downloads                  | Operation handles/status and complete sharded GGUF grouping                                                 | Put reconnectable operations and shard sets in llama-skein |
| UI                         | Search/filter/detail/compare/installed/download/plan workflows                                              | Port interactions into native Solid/TUI                    |
| Hardware/provider adapters | Broad single-machine support                                                                                | Reject: duplicates llama-skein                             |
| Rust API/TUI/MCP           | Useful standalone product surfaces                                                                          | Reject as ecosystem runtime dependency                     |

## Skein advantages

| Capability                            | Why it is useful                                         | Destination                                     |
| ------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| Top GGUF and related-family HF search | Useful live discovery beyond a static list               | opencode-skein catalog                          |
| Installed-name keyword extraction     | Finds community siblings of unusual local models         | opencode-skein catalog                          |
| Family/version upgrade classification | Separates upgrades from fresh model families             | opencode-skein gallery                          |
| Quant parsing/ranking                 | Handles common, IQ, UD, and community APEX labels        | opencode-skein artifact normalization           |
| Context-floor selection               | Avoids choosing a high quant with unusably small context | opencode-skein hard filter, backed by llama fit |
| HF URL normalization                  | Handles file-info and blob URLs                          | llama-skein host trust boundary                 |
| Size-only fit matrix                  | Simple but weaker than runtime hypothetical fit          | Retire                                          |
| Skein CLI gallery/pull presentation   | Duplicates target experience                             | Remove after web/TUI parity                     |

## llama-skein and llama-swap advantages

| Capability                     | Current status                                                       | Plan                                          |
| ------------------------------ | -------------------------------------------------------------------- | --------------------------------------------- |
| Exact installed fit            | Runtime/backend/GGUF-aware and authoritative                         | Keep                                          |
| Hypothetical fit               | Implemented in isolated branch; one live smoke task remains          | Merge first                                   |
| Hardware/storage/performance   | Host-local source of truth                                           | Keep and expose generated contract            |
| Runtime model state            | Current llama-swap lifecycle and `/api/ps` work already incorporated | Reuse                                         |
| Robust load/shutdown streaming | Present from current upstream                                        | Reuse; test regressions                       |
| Pull/register                  | Exists with NDJSON progress                                          | Replace with reconnectable operation contract |
| Resume after disconnect        | Missing; partial is deleted                                          | Add                                           |
| Multi-shard install            | Missing                                                              | Port llmfit behavior to Go                    |
| Exact revision/digest identity | Incomplete                                                           | Add                                           |
| Load/unload/remove             | Implemented, incompletely represented in OpenAPI                     | Make contract-first                           |

## Upstream status

### opencode

- The fork's merge base is more than 800 upstream commits behind its tracked
  upstream ref, and the latest remote `dev` advances further.
- Relevant upstream improvements include V2 model selector/controller,
  improved search, model context tooltip, V2 model settings, provider-dialog
  consolidation, model defaults/compatibility data, and model-selection E2E.
- Decision: run the existing merge/worktree sync before gallery UI work. Do
  not rebase the long-lived fork.

### llama-swap

- llama-skein's current main contains the latest tracked upstream merge base
  (v223-era at analysis time).
- Relevant capabilities already present include model state/lifecycle,
  `/api/ps`, robust load/shutdown behavior, current routing backend, and
  expanded performance monitoring.
- Decision: no preparatory upstream merge is required; preserve and test these
  seams while adding llama-skein-specific artifact operations.
