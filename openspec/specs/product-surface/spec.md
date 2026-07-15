# Product Surface Specification

## Purpose

Define the supported product surfaces for this TUI/CLI-focused KanCode fork after non-TUI packages and platforms were pruned.

## Requirements

### Requirement: TUI and CLI Are the Primary Product Surfaces

The product SHALL be delivered as a terminal user interface (TUI) and related CLI entrypoints under the KanCode product name. Interactive development SHALL start with `bun dev` from the repo root (or equivalent package scripts under `packages/opencode`), which launches the KanCode TUI.

#### Scenario: Local development starts the TUI
- **WHEN** a developer runs `bun dev` from the repository root
- **THEN** the KanCode TUI starts for interactive use
- **AND** the developer MAY pass a target directory (for example `bun dev .`)

### Requirement: Web App Desktop and Console Surfaces Are Out of Scope

The repository MUST NOT treat pruned non-TUI packages as current product surfaces. Specs, proposals, and designs SHALL NOT assume restoration of `packages/app`, `packages/desktop`, `packages/web`, `packages/console`, or similar removed platforms unless an explicit change proposes bringing one back.

#### Scenario: Planning excludes pruned platforms by default
- **WHEN** an OpenSpec change is proposed for normal product work
- **THEN** the change targets TUI/CLI and supporting backend packages only
- **AND** it does not require `packages/app`, `packages/desktop`, `packages/web`, or `packages/console`

### Requirement: Shared UI Package Supports TUI Not Standalone Web App

The `@opencode-ai/ui` package MAY provide shared UI primitives and themes used by the TUI stack. It MUST NOT be treated as a standalone web application product surface in this fork.

#### Scenario: UI package is a library dependency
- **WHEN** a change references `@opencode-ai/ui`
- **THEN** it treats the package as a shared library for terminal/UI components
- **AND** it does not introduce a separate web app entry product
