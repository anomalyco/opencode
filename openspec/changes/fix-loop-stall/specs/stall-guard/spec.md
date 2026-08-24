# Stall Guard

## MODIFIED Requirements

### Requirement: Loop with tool calls does not stall

The no-progress streak SHALL be reset to 0 whenever a loop iteration makes tool calls.

#### Scenario: Loop with tool calls does not stall

- **WHEN** a loop iteration makes tool calls
- **THEN** the no-progress streak SHALL be reset to 0, regardless of output similarity

### Requirement: Loop with meaningful output change does not stall

The no-progress streak SHALL be reset to 0 whenever the output changes meaningfully between iterations.

#### Scenario: Loop with meaningful output change does not stall

- **WHEN** the output changes meaningfully between iterations
- **THEN** the no-progress streak SHALL be reset to 0, even if bigram similarity is high

### Requirement: Loop with no progress stalls

The loop SHALL stop with status `stalled` only after confirming no tool calls AND near-identical output.

#### Scenario: Loop with no progress stalls

- **WHEN** the no-progress limit is reached
- **THEN** the loop SHALL stop with status `stalled` only after confirming no tool calls AND near-identical output
