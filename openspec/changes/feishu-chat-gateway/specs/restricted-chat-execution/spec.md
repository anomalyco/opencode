## ADDED Requirements

### Requirement: Gateway uses the embedded OpenCode host
The system SHALL call OpenCode through one process-scoped `packages/sdk-next` host using the real in-memory router and SHALL NOT require a global `opencode` executable, TUI process, CLI child process, or listening HTTP port.

#### Scenario: Process starts the OpenCode host
- **WHEN** the gateway worker starts
- **THEN** it creates one scoped embedded OpenCode host and reuses it for all gateway Sessions until shutdown

#### Scenario: Chat task invokes OpenCode
- **WHEN** an accepted task reaches model execution
- **THEN** the worker creates or adopts the deterministic Session and submits the prompt through the embedded Session V2 client

### Requirement: Every gateway Session uses the dedicated Agent and DeepSeek model
The system SHALL create or reconcile every gateway Session with the `feishu-chat` Agent and a startup-validated DeepSeek model reference.

#### Scenario: New Session is created
- **WHEN** no Session exists for a normalized Feishu conversation
- **THEN** the gateway creates the deterministic Session with the `feishu-chat` Agent, validated DeepSeek model, and project Location

#### Scenario: Existing Session is adopted
- **WHEN** the deterministic Session already exists after a restart or later message
- **THEN** the gateway verifies or restores the required Agent and DeepSeek model before admitting the new prompt

#### Scenario: Selected model is not usable DeepSeek
- **WHEN** the configured model cannot be resolved, is not a DeepSeek model, or lacks usable authentication
- **THEN** the gateway fails startup or the preflight check before receiving chat work and does not silently fall back to another model

### Requirement: Chat execution cannot use tools
The system SHALL expose an empty tool set to `feishu-chat`, SHALL apply a default-deny permission policy, and MUST NOT execute file, terminal, database, network tool, Skill, MCP, or project-modification actions requested through a Feishu message.

#### Scenario: User requests a forbidden capability
- **WHEN** a user asks the robot to read or write a file, execute a command, modify code, use a Skill or MCP server, or access a database
- **THEN** the assistant returns a text explanation that the capability is unavailable and no tool execution boundary is invoked

#### Scenario: Model emits a tool call despite configuration
- **WHEN** a Session event indicates any tool call request
- **THEN** the gateway interrupts the active Session ownership chain, records an `operation_blocked` policy event, and does not execute the requested tool

#### Scenario: Tool registry changes elsewhere
- **WHEN** other OpenCode packages register application tools in the same repository
- **THEN** the `feishu-chat` Agent still exposes no tools and its default-deny permission policy remains effective

### Requirement: Gateway returns only the final assistant text
The system SHALL derive the reply from the durable Session result for the admitted prompt and SHALL record completion metadata without recording or exposing hidden reasoning.

#### Scenario: Successful provider turn
- **WHEN** the admitted prompt reaches a completed assistant message
- **THEN** the gateway obtains the final text associated with that turn and records model identity, elapsed time, token usage, cost when available, and completion status

#### Scenario: Provider emits reasoning
- **WHEN** the provider emits reasoning or hidden-thought events
- **THEN** the gateway neither stores that reasoning in its event log nor sends it to Feishu

#### Scenario: Completed turn has no final text
- **WHEN** the provider turn becomes terminal without a non-empty assistant text
- **THEN** the gateway records a model-output failure and sends at most one sanitized failure response with the trace ID
