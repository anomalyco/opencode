## ADDED Requirements

### Requirement: Gateway maintains an append-only event history
The system SHALL store gateway history as append-only events in a versioned local SQLite database outside the Git worktree and SHALL NOT update, overwrite, or delete an event after it is committed.

#### Scenario: Task state advances
- **WHEN** a task moves from one processing state to another
- **THEN** the current-state record advances and a new immutable event describing the transition is committed in the same consistency boundary

#### Scenario: Earlier interpretation is corrected
- **WHEN** a user or operator corrects an earlier message, answer, or classification
- **THEN** the gateway appends a correction event linked to the original events and preserves the original history unchanged

### Requirement: Every user and assistant message is stored whole and by sentence
The system SHALL store the sanitized complete original text and ordered sentence events for every accepted user message and every final assistant response.

#### Scenario: Message has reliably separable sentences
- **WHEN** a message can be deterministically split using supported punctuation and line boundaries
- **THEN** the gateway stores one complete-message event and one sentence event per segment with stable sentence IDs and increasing `sentence_index`

#### Scenario: Message cannot be reliably split
- **WHEN** a message has no reliable sentence boundaries or would require rewriting to split
- **THEN** the gateway stores the complete message as one sentence with index zero and does not alter its meaning

#### Scenario: Mention is removed for model routing
- **WHEN** a group message contains the robot mention used for routing
- **THEN** the log preserves the sanitized original message and separately records the normalized prompt text sent to OpenCode

### Requirement: Events form one traceable chain for each turn
The system SHALL associate all events for one accepted user message and its final outcome with one `trace_id` and SHALL preserve parent, conversation, turn, message, sentence, ordering, version, status, duration, and related-event identifiers needed to reconstruct the chain.

#### Scenario: Successful conversation turn
- **WHEN** a task is accepted, executed, answered, and delivered
- **THEN** an auditor can traverse from the received Feishu message through sentence events, Session and prompt identifiers, Agent and model selection, model completion, full and sentence-level answer, and delivery result using the stored identifiers

#### Scenario: Failed conversation turn
- **WHEN** a task fails during admission, model execution, policy enforcement, or delivery
- **THEN** the same trace records the failed stage, error classification, retryability, elapsed time, and terminal or pending state

#### Scenario: Future business events are appended
- **WHEN** a later MySQL change adds intent, Skill, tool, SQL, result, feedback, or correction events
- **THEN** those events can reuse the existing conversation, turn, trace, message, sentence, parent, and related-event identifiers without rewriting chat history

### Requirement: Log coverage includes execution and delivery evidence
The system SHALL append events for message receipt, Agent and model selection, prompt admission, model start, model completion or failure, policy blocking, final answer, send attempt, retry, confirmed delivery, confirmed non-delivery, and uncertain delivery whenever those stages occur.

#### Scenario: Model and reply succeed
- **WHEN** a prompt produces a final answer that Feishu confirms as delivered
- **THEN** the trace contains evidence for prompt admission, model execution, answer persistence before send, send attempt, and confirmed delivery

#### Scenario: Tool policy blocks execution
- **WHEN** a model requests a tool
- **THEN** the trace contains the requested tool identity, a sanitized request summary, the blocking policy, Session interruption result, and proof that no tool result event was produced

### Requirement: Authentication secrets and hidden reasoning never enter logs
The system MUST NOT write Feishu secrets, API keys, tokens, cookies, session credentials, database passwords, complete connection strings, private keys, or model hidden reasoning to SQLite, fallback logs, console output, error replies, or test snapshots.

#### Scenario: Structured value contains a credential field
- **WHEN** a log candidate contains a known authentication field or configured secret value
- **THEN** the logging boundary removes or replaces that value before persistence and preserves only a non-secret configuration alias when needed

#### Scenario: Error includes an upstream credential
- **WHEN** an SDK or provider error message contains a configured secret or credential-bearing header
- **THEN** the stored and displayed error is sanitized before any sink receives it

#### Scenario: Normal business content is recorded
- **WHEN** a message contains ordinary business information and no authentication secret
- **THEN** the system records the original business content without default masking

### Requirement: Primary log failure is explicit
The system SHALL treat a failed primary SQLite event write as a processing failure and SHALL append a minimal sanitized diagnostic to an independent local fallback file when possible.

#### Scenario: Receipt log cannot be written
- **WHEN** SQLite fails while admitting a received message
- **THEN** the task is not represented as successfully admitted, model execution does not start for that attempt, and the fallback diagnostic identifies the failed stage and trace candidate without secrets

#### Scenario: Completion log cannot be written
- **WHEN** SQLite fails before the final answer or delivery result can be committed
- **THEN** the gateway does not claim successful logging, records a fallback diagnostic, and leaves the task in a recoverable or explicitly failed state
