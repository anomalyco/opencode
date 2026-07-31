## ADDED Requirements

### Requirement: Gateway starts through a Feishu WebSocket connection
The system SHALL run the Feishu gateway on the current Windows computer through the official Feishu WebSocket Channel without requiring a public callback address or an additional OpenCode HTTP listener.

#### Scenario: Valid local startup
- **WHEN** the required Feishu credentials and a usable DeepSeek model are available
- **THEN** the gateway establishes the Feishu long connection and remains ready to receive messages using one documented local start command

#### Scenario: Missing startup configuration
- **WHEN** one or more required configuration fields are missing
- **THEN** startup fails before connecting and reports only the missing field names without printing any configured secret value

#### Scenario: Invalid connection credentials
- **WHEN** the Feishu credentials are rejected during the long-connection handshake
- **THEN** startup fails with a sanitized reason and does not start the message worker

### Requirement: Gateway accepts only supported chat messages
The system SHALL accept supported text messages from direct chats and SHALL accept group-chat messages only when the robot is explicitly mentioned.

#### Scenario: Direct-chat text message
- **WHEN** a user sends a non-empty supported text message to the robot in a direct chat
- **THEN** the gateway persists and schedules that message for one model response

#### Scenario: Mentioned group-chat message
- **WHEN** a user explicitly mentions the robot in a group-chat text message
- **THEN** the gateway removes only the robot mention used for routing, preserves the remaining user text, and schedules one model response

#### Scenario: Unmentioned group-chat message
- **WHEN** a group-chat message does not explicitly mention the robot
- **THEN** the gateway silently ignores it without invoking OpenCode or sending a reply

#### Scenario: Unsupported or empty message
- **WHEN** an event contains no supported non-empty text content
- **THEN** the gateway does not invoke OpenCode and records or ignores the event according to its unsupported-message classification without exposing an error to the chat

### Requirement: Message receipt is durably admitted before background inference
The system SHALL persist the accepted message, its sentence events, and a recoverable task before acknowledging local receipt, and SHALL execute model inference outside the Feishu event callback.

#### Scenario: Successful durable admission
- **WHEN** an accepted Feishu event is received
- **THEN** the gateway commits the receipt events and pending task before returning from the callback, with callback completion targeting less than three seconds

#### Scenario: Admission persistence failure
- **WHEN** the gateway cannot commit the accepted message and task
- **THEN** it does not report the task as admitted, does not start model inference for that attempt, and writes a sanitized fallback diagnostic

### Requirement: Gateway sends one final text reply to the originating conversation
The system SHALL send exactly one complete final text response to the originating direct chat or group message thread after model execution completes.

#### Scenario: Direct-chat response
- **WHEN** a direct-chat task produces a final assistant text
- **THEN** the gateway sends one text reply to that direct chat and records the delivery result

#### Scenario: Group-thread response
- **WHEN** a mentioned group-chat task produces a final assistant text
- **THEN** the gateway sends one text reply in the originating thread or root-message context and records the delivery result

#### Scenario: Group reply mentions the requester
- **WHEN** an accepted group-chat task produces a final answer
- **THEN** the gateway uses the official Feishu Channel client's `mentions` send option for a native Feishu mention of the original requester before the answer in the originating thread or root-message context

#### Scenario: Direct reply has no requester mention
- **WHEN** an accepted direct-chat task produces a final answer
- **THEN** the gateway sends the answer without requester mention metadata

#### Scenario: Requester mention metadata is captured only for group tasks
- **WHEN** the gateway accepts a group-chat task or a direct-chat task
- **THEN** it captures and persists requester mention metadata only for the accepted group-chat task, and the direct-chat task and its reply contain no requester mention metadata

#### Scenario: Mention presentation does not change the answer body
- **WHEN** a group reply is sent, retried, or recovered after restart
- **THEN** the persisted final answer remains the exact body-only text and the Feishu delivery adapter applies the requester mention only through the official Channel client's `mentions` send option

#### Scenario: Model emits intermediate output
- **WHEN** OpenCode emits text deltas, reasoning events, or other intermediate progress
- **THEN** the gateway does not send those intermediate values to Feishu and waits for the complete final text

### Requirement: Connection and upstream failures remain isolated
The system SHALL isolate a failed message or temporary connection interruption from unrelated conversations and SHALL provide a sanitized failure response with a trace identifier when a model task cannot complete.

#### Scenario: Long connection is interrupted
- **WHEN** the Feishu Channel reports a recoverable disconnection
- **THEN** the official SDK reconnects, the gateway records the disconnect and recovery events, and already persisted tasks remain available

#### Scenario: DeepSeek request fails
- **WHEN** DeepSeek times out, is rate limited, rejects authentication, or returns a provider failure
- **THEN** the gateway records the failed stage and sends at most one concise failure message containing the task trace ID without inventing an answer

#### Scenario: One conversation fails
- **WHEN** one task reaches a terminal failure
- **THEN** tasks for other conversation keys can continue and the failed conversation advances only after its failure state is durably recorded
