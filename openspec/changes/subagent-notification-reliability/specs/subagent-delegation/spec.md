## ADDED Requirements

### Requirement: background subagent completion reliably wakes the parent

A background subagent's completion SHALL resume the parent session's turn via injected synthetic
message without requiring the user to send another message.

#### Scenario: parent resumes without further input
- **WHEN** a background subagent placed on a slower target completes after the parent's own work is done
- **THEN** the parent's turn resumes and reacts to the injected result without any additional human input

### Requirement: background subagent failure is distinguishable from silence

A background subagent that errors SHALL notify the parent of the failure, distinguishable from a
successful result.

#### Scenario: an errored subagent produces a failure notification
- **WHEN** a background subagent's child session ends in an error
- **THEN** the parent receives a notification identifying it as a failure, not a result

### Requirement: a non-responding background subagent has a bounded wait

A background subagent that neither completes nor errors within a configured window SHALL produce
an explicit timeout notification to the parent.

#### Scenario: a hung subagent is reported, not silently waited on
- **WHEN** a background subagent produces no completion or error within the configured window
- **THEN** the parent receives an explicit timeout notification within that window
