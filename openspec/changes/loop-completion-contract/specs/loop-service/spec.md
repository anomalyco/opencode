## MODIFIED Requirements

### Requirement: the completion signal is disclosed to the model
Every loop iteration SHALL include, in the prompt sent to the model, an explicit
statement of the completion token and the condition under which to emit it. The
user-supplied prompt text SHALL remain the first content part and SHALL NOT be
rewritten. A loop SHALL NOT rely on a token the model was not told about.

#### Scenario: the model is told the stop word
- **WHEN** an iteration is dispatched for a loop created with prompt `"refactor the parser"`
- **THEN** the parts sent to the model contain `"refactor the parser"` unmodified as the first text part, and a subsequent part naming the exact completion token

#### Scenario: the contract does not leak outside loops
- **WHEN** an ordinary (non-loop) session turn is dispatched
- **THEN** no loop contract text is present in the prompt

### Requirement: configurable completion token
Loop creation SHALL accept an optional `completionToken`. When omitted it SHALL default
to `<promise>COMPLETE</promise>`. The disclosed contract and the detector SHALL both use
the loop's configured token.

#### Scenario: a persona-aligned token terminates the loop
- **WHEN** a loop is created with `completionToken` `<promise>TASK_COMPLETE</promise>` and an iteration emits that token as its last line
- **THEN** the loop ends with status `completed`

### Requirement: robust completion detection
Detection SHALL normalise case and internal whitespace, SHALL accept the token inside a
fenced code block, and SHALL only match an occurrence within the trailing region of the
iteration output. An occurrence that also appears verbatim in that iteration's input
prompt SHALL be ignored.

#### Scenario: trailing token completes the loop
- **WHEN** an iteration's output ends with the completion token on its own line
- **THEN** the loop ends with status `completed`

#### Scenario: mid-response mention does not complete the loop
- **WHEN** an iteration's output mentions the token in a sentence near the start and then continues working for several hundred more characters
- **THEN** the loop does not complete and proceeds to the next iteration

#### Scenario: echoed user prompt does not complete the loop
- **WHEN** a user's loop prompt itself contains the completion token and the model quotes the prompt back
- **THEN** the loop does not complete on that echo

### Requirement: completion is reachable in normal operation
A loop whose task is finished SHALL be able to reach status `completed` without
depending on `stalled`, `max_reached`, or `cancelled`.

#### Scenario: finished work reports success, not exhaustion
- **WHEN** a loop with `--max 50` finishes its task on iteration 3 and emits the token
- **THEN** the loop ends with status `completed` at iteration 3, not `max_reached` at 50
