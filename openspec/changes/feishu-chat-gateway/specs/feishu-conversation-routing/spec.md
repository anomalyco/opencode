## ADDED Requirements

### Requirement: Feishu conversations map to stable OpenCode Sessions
The system SHALL derive a deterministic OpenCode Session ID from a versioned hash of the normalized Feishu conversation key and SHALL avoid storing raw external conversation identifiers as internal primary keys.

#### Scenario: Direct-chat mapping
- **WHEN** messages have the same Feishu direct-chat ID and sender ID
- **THEN** they map to the same OpenCode Session across process restarts

#### Scenario: Direct-chat isolation
- **WHEN** two direct-chat messages differ by chat ID or sender ID
- **THEN** they map to different OpenCode Sessions

#### Scenario: Group-thread mapping
- **WHEN** group messages belong to the same `thread_id`, or the same `root_id` when no `thread_id` exists
- **THEN** they map to the same OpenCode Session

#### Scenario: New group thread without a thread identifier
- **WHEN** an accepted group message has neither `thread_id` nor `root_id`
- **THEN** its own message ID becomes the deterministic root for that new conversation thread

#### Scenario: Group-thread isolation
- **WHEN** accepted group messages belong to different groups or different thread roots
- **THEN** they map to different OpenCode Sessions

### Requirement: Repeated Feishu messages use deterministic prompt identity
The system SHALL map each Feishu message ID to one deterministic OpenCode prompt message ID and SHALL treat conflicting reuse as an error rather than a new prompt.

#### Scenario: Exact duplicate delivery
- **WHEN** Feishu delivers the same message event more than once with identical normalized content and routing
- **THEN** the gateway reuses the existing task, Session ID, and prompt message ID without producing another model call or reply

#### Scenario: Conflicting message reuse
- **WHEN** the same Feishu message ID is received with different normalized content, conversation routing, or delivery mode
- **THEN** the gateway records a conflict, does not admit a second prompt, and does not send a second reply

### Requirement: Processing order is scoped by conversation
The system SHALL process tasks for the same OpenCode Session in durable receive order and SHALL allow tasks for different Sessions to execute concurrently within a configured concurrency limit.

#### Scenario: Two messages in one conversation
- **WHEN** a second accepted message arrives while the first message for the same Session is running
- **THEN** the second task waits until the first task reaches a durable terminal or continuation-safe state

#### Scenario: Messages in different conversations
- **WHEN** accepted messages belong to different Sessions
- **THEN** their model work can run concurrently and a failure in one Session does not block the other

### Requirement: Pending tasks recover after process restart
The system SHALL persist enough task state to resume or reconcile every non-terminal task after a process restart.

#### Scenario: Restart before prompt admission
- **WHEN** the process restarts with a task in `received` state
- **THEN** the worker submits that task using its original deterministic Session and prompt message IDs

#### Scenario: Restart after prompt admission
- **WHEN** the process restarts after OpenCode durably admitted the prompt but before the gateway recorded a final answer
- **THEN** the worker uses the same prompt message ID and durable Session history to reconcile the exact retry without creating a second user message

#### Scenario: Restart after confirmed delivery
- **WHEN** the process restarts with a task recorded as delivered
- **THEN** the worker does not call the model or send the reply again

### Requirement: Reply retry behavior prevents blind duplication
The system SHALL distinguish confirmed delivery, confirmed non-delivery, and uncertain delivery, and MUST NOT automatically retry a reply whose delivery outcome is uncertain.

#### Scenario: Confirmed transient non-delivery
- **WHEN** the Feishu API explicitly confirms that a reply was not sent and classifies the error as retryable
- **THEN** the gateway can retry the same reply according to the bounded retry policy

#### Scenario: Confirmed delivery
- **WHEN** the Feishu API confirms that a reply was sent
- **THEN** the gateway records `delivered` and never sends that task reply again

#### Scenario: Network outcome is uncertain
- **WHEN** the send call ends without enough evidence to know whether Feishu received the reply
- **THEN** the gateway records `uncertain_delivery`, stops automatic sends for that task, and retains the trace for manual review
