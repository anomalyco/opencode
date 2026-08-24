## ADDED Requirements

### Requirement: Gallery works directly with discovered hosts

opencode-skein SHALL discover and manage llama-skein hosts through its
existing local-provider discovery without requiring Skein or llmfit.

#### Scenario: Skein is stopped

- **WHEN** discovered llama-skein hosts and Hugging Face are reachable while Skein is unavailable
- **THEN** catalog search, fit comparison, installation, progress, inventory, and lifecycle management remain usable

### Requirement: Candidate identity is distinct from artifact identity

The catalog SHALL represent a model candidate separately from immutable,
revision-pinned variant artifact sets.

#### Scenario: Candidate has several quants

- **WHEN** a repository contains several complete quant or shard sets
- **THEN** the gallery presents each as a distinct fit/installable variant with exact total bytes

### Requirement: Catalog sources are merged with provenance

opencode-skein SHALL merge a reviewed seed, bounded live Hugging Face search,
explicit repositories, and local overlays while retaining source and
freshness.

#### Scenario: Hugging Face is unavailable

- **WHEN** live search fails
- **THEN** the gallery serves the reviewed seed and stale cache with explicit source and stale indicators

### Requirement: Fit is evaluated across discovered hosts

opencode-skein SHALL request hypothetical fit for exact candidate variants
from every compatible discovered llama-skein host using bounded concurrency.

#### Scenario: Hosts report mixed results

- **WHEN** the same variant fits one host, is tight on another, and is unsupported on a third
- **THEN** the gallery displays each host result independently without collapsing them into one verdict

### Requirement: Recommendations expose evidence

The gallery MUST apply compatibility, policy, artifact completeness, and
required context as hard filters before ordering candidates and SHALL expose
fit, context, quality, speed, capability, provenance, recency, and popularity
evidence separately.

#### Scenario: Popular model does not meet context requirement

- **WHEN** a highly downloaded variant cannot serve the requested context but a less popular compatible variant can
- **THEN** the compatible variant ranks higher and the reason is visible

#### Scenario: Portable estimate conflicts with runtime fit

- **WHEN** translated llmfit evidence predicts compatibility but live llama-skein reports no-fit
- **THEN** the variant is not recommended for that host and both evidence sources remain labeled

### Requirement: Installed and discoverable models share one experience

The web/desktop and terminal interfaces SHALL expose Installed, Discover, and
Operations views with consistent host and evidence vocabulary.

#### Scenario: Installation completes

- **WHEN** llama-skein registers a successfully installed model
- **THEN** the model moves to installed state and becomes selectable in the existing session picker without restart

### Requirement: Model operations are host-authoritative

opencode-skein SHALL submit exact install and lifecycle operations to the
selected llama-skein host and SHALL observe/cancel them by host operation ID.

#### Scenario: User reconnects to an active operation

- **WHEN** the workspace is reopened with a remembered host operation ID
- **THEN** opencode-skein fetches current progress from llama-skein rather than assuming failure or restarting

### Requirement: Destructive and resource-changing actions are explicit

The UI MUST show affected host, artifacts, bytes, license/provenance, fit,
disk, loaded state, and expected eviction before confirmation where relevant.

#### Scenario: Loading would evict another model

- **WHEN** host routing reports that the selected load conflicts with a running model
- **THEN** the user sees the affected model and explicitly confirms before the load is requested

### Requirement: Source adoption remains auditable

opencode-skein MUST record the upstream repository, commit, destination,
transformation, and license attribution for substantial code, data,
algorithms, tests, or interactions adopted from llmfit or Skein.

#### Scenario: llmfit behavior is translated

- **WHEN** a ranking formula, dataset, test, or UI workflow is adopted
- **THEN** the adoption manifest identifies its exact source and local implementation

### Requirement: Older hosts degrade by capability

Missing hypothetical fit or model-operation capabilities SHALL disable only
the dependent action and SHALL NOT break existing installed-model inference.

#### Scenario: Host supports inventory but not hypothetical fit

- **WHEN** an older host is discovered
- **THEN** installed models remain usable and candidate fit for that host is reported unknown

### Requirement: Frontends remain native

The application SHALL use native Solid and terminal components and SHALL NOT
require React, Rust, or the llmfit process at runtime.

#### Scenario: llmfit UI interaction is adopted

- **WHEN** a useful llmfit-web workflow is ported
- **THEN** it is implemented with opencode-skein primitives and covered by local tests
