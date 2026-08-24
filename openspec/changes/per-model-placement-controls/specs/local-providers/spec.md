# Show and edit where a local model's layers run

## ADDED Requirements

### Requirement: Avoidable CPU offload is visible in the sidebar

The sidebar SHALL indicate, for a local llama-skein provider, when the loaded
model's weights are needlessly host-resident, alongside the throughput reading
already shown.

The indicator SHALL prefer the host's `under_offloaded` flag when present. Against
hosts that predate it, the client SHALL fall back to the mechanical condition
already derivable from `/api/fit`: `run_mode == "cpu_offload"` while
`vram_required_mb <= vram_total_mb`.

It SHALL NOT fire for a model that genuinely needs host RAM to run, because a
correct hybrid placement on a small card is not a fault and must not nag.

The indicator SHALL name the host-resident amount, so the cost is legible rather
than abstract.

#### Scenario: Model needlessly split across CPU and GPU

- **WHEN** the loaded model reports `run_mode: "cpu_offload"` with
  `host_resident_mb: 7165` and `vram_required_mb` within total VRAM
- **THEN** the sidebar shows that ~7 GB of weights are in host RAM and the model
  is not fully GPU-resident

#### Scenario: Model too large for the card

- **WHEN** the loaded model's weights exceed VRAM, so hybrid placement is the only
  way it runs
- **THEN** no warning indicator is shown

#### Scenario: Fully GPU-resident model

- **WHEN** the loaded model reports `run_mode: "gpu"`
- **THEN** no warning indicator is shown

#### Scenario: Host predates the flag

- **WHEN** the provider's `/api/fit` response has no `under_offloaded` field
- **THEN** the indicator is derived from `run_mode` and `vram_required_mb`, and the
  UI degrades silently rather than erroring

### Requirement: Placement is editable per model

The client SHALL provide a control to view and change a local model's layer
placement, writing `n_gpu_layers` through `PATCH /api/models/config/{id}`, which
already accepts that field.

Where the host reports that the counterfactual plan is full GPU residency, clearing
the pin SHALL be offered as the primary action, so llama-skein computes placement
rather than the operator maintaining a constant that goes stale on the next model or
card. Setting an explicit value SHALL remain available for a deliberate pin.

The control SHALL state before the write that applying it reloads the model and
drops its loaded state.

The client SHALL NOT compute placement itself, and SHALL NOT alter a placement flag
without an explicit operator action.

#### Scenario: Operator clears an unintended pin

- **WHEN** a model is flagged as needlessly offloaded and the operator chooses to
  remove the pin
- **THEN** the client patches the model config to drop `--n-gpu-layers` and reports
  that the model will reload

#### Scenario: Operator sets a deliberate value

- **WHEN** the operator enters an explicit layer count
- **THEN** that value is written verbatim and no client-side adjustment is applied

#### Scenario: Reload cost is stated up front

- **WHEN** the operator opens the control for a currently-loaded model
- **THEN** the reload consequence is shown before the write is offered, not after
  it is applied

#### Scenario: No silent correction

- **WHEN** the client detects a needlessly offloaded model
- **THEN** it surfaces the finding and takes no action until the operator chooses one

#### Scenario: Non-llama-skein provider

- **WHEN** the session's provider does not answer the llama-skein config API
- **THEN** the control is unavailable and nothing is shown, consistent with the
  existing tuning and context surfaces
