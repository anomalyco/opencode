# Model Picker and VRAM Display Correctness

## ADDED Requirements

### Requirement: Model size is visible regardless of filter state
The model picker SHALL display each model's size for every row that has size data, in both the recents/favorites view and the provider-browsing view, and SHALL continue to display it while a filter query is active. Group provenance in a flattened filtered list SHALL be rendered in a field distinct from the size, so that neither displaces the other.

#### Scenario: Filtering a provider's model list
- **WHEN** the user browses a provider's models and types a filter query
- **THEN** each matching row still shows its size, and the provider name is shown in a separate field rather than replacing the size

#### Scenario: Empty query
- **WHEN** no filter query is active
- **THEN** rows show size exactly as they do today, with no regression to the recents/favorites view

#### Scenario: Model with no size data
- **WHEN** a model has no known size
- **THEN** its size field is empty and the row renders without error

### Requirement: Fit-based recommendation
The picker SHALL annotate each model with its fit against the target provider, sourced from the provider's fit report, and SHALL mark a recommended choice. Models that cannot fit SHALL be visibly marked. When fit data is unavailable or stale, the picker SHALL degrade to an unannotated list and remain usable.

#### Scenario: Model exceeds provider capacity
- **WHEN** a model's fit report indicates it cannot fit the target provider
- **THEN** the row is visibly marked as not fitting, and it is not the recommended choice

#### Scenario: Fit data unavailable
- **WHEN** the provider's fit endpoint is unreachable or returns no usable data
- **THEN** the picker renders without annotations and without blocking selection

#### Scenario: Advisory max safe context
- **WHEN** the fit report's maximum safe context is known to be unreliable
- **THEN** the recommendation treats it as advisory and does not present it as a guarantee

### Requirement: Hardware polling is keyed to the model
The sidebar hardware poll SHALL be keyed on both the provider endpoint and the model identity. On a change to either, the previously committed sample SHALL be dropped immediately and a fresh sample fetched, rather than waiting for the next scheduled poll. The key SHALL remain a string-equality comparison so that per-message state updates do not restart the poll.

#### Scenario: Switching model within one provider
- **WHEN** the user switches to a different model on the same provider
- **THEN** the stale sample is cleared and a fresh one is fetched immediately, so the VRAM display reflects the newly selected model rather than the previous one

#### Scenario: Streaming does not restart the poll
- **WHEN** state updates arrive on every stream tick with an unchanged provider and model
- **THEN** the poll effect does not re-run, preserving the existing behavior the string-equality memo was introduced for

#### Scenario: Switching provider
- **WHEN** the user switches provider
- **THEN** the existing reset-and-refetch behavior is unchanged

### Requirement: Discovered size is not clobbered by an undefined existing value
When merging a discovered model entry with an existing one, an absent or undefined size on the existing entry SHALL NOT overwrite a size present on the discovered entry.

#### Scenario: Config-declared entry with no size
- **WHEN** an existing model entry carries an undefined size and a discovered entry carries a real size
- **THEN** the merged entry retains the discovered size

### Requirement: Local providers show their total VRAM in the picker
For each local provider (one with a configured base URL), the picker SHALL display the provider's total VRAM or unified memory, sourced from its hardware endpoint, when that data is available. The picker SHALL NOT block opening on this fetch, and a provider that does not answer SHALL simply show no VRAM label.

#### Scenario: Browsing or filtering a local provider's models
- **WHEN** the hardware fetch for a local provider has completed successfully
- **THEN** its total VRAM (or unified memory) is shown alongside its name, in both the unfiltered group header and the filtered provenance text

#### Scenario: Provider does not support the hardware endpoint
- **WHEN** a provider's hardware fetch fails or the provider does not support it
- **THEN** the picker renders normally with no VRAM label for that provider

### Requirement: A model can be set as the default
The picker SHALL offer an action to set the currently selected model as the default for the workspace, persisting the selection so it is used on the next session without requiring a restart.

#### Scenario: Setting a default model
- **WHEN** the user triggers "Set as default" on a model
- **THEN** the workspace configuration is updated with that model and a subsequent session uses it as the fallback model
