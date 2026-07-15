## MODIFIED Requirements

### Requirement: TUI and CLI Are the Primary Product Surfaces

The product SHALL be delivered as a terminal user interface (TUI) and related CLI entrypoints under the KanCode product name. Interactive development SHALL start with `bun dev` from the repo root (or equivalent package scripts under `packages/opencode`), which launches the KanCode TUI.

#### Scenario: Local development starts the TUI
- **WHEN** a developer runs `bun dev` from the repository root
- **THEN** the KanCode TUI starts for interactive use
- **AND** the developer MAY pass a target directory (for example `bun dev .`)
