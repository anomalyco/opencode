## MODIFIED Requirements

### Requirement: each iteration runs in a fresh child session
Each loop iteration SHALL run in a newly created child session of the loop's parent
session, rather than re-prompting into a shared session. Context SHALL NOT accumulate
across iterations. `Info.sessionID` SHALL remain the parent session for loop
identification, and the most recent child SHALL be recorded on `Info.iterationSessionID`.

#### Scenario: context does not grow across iterations
- **WHEN** a loop has run 10 iterations
- **THEN** the 10th iteration's context contains the continuation prompt and system prompt only, not the preceding 9 iterations' transcripts

#### Scenario: iterations remain navigable under the parent
- **WHEN** a loop has run 4 iterations
- **THEN** the session list shows one loop parent with 4 child sessions, and `Info.iterationSessionID` names the most recent child

### Requirement: the continuation prompt adapts to the previous outcome
The prompt for an iteration SHALL be selected from the previous iteration's outcome
signals — tool-call count, output length, and similarity to the prior output. The
user-supplied prompt SHALL always form the first message; any directive SHALL augment it
rather than replace it.

#### Scenario: a stalled iteration is nudged to act
- **WHEN** the previous iteration made zero tool calls and produced only a short plan
- **THEN** the next prompt augments the user's prompt with a directive to execute the plan starting with a tool call

#### Scenario: an empty response is called out
- **WHEN** the previous iteration produced empty output
- **THEN** the next prompt augments the user's prompt with a directive to continue using tool calls

#### Scenario: a spinning iteration is redirected
- **WHEN** the previous iteration made tool calls but produced near-identical output to the one before it
- **THEN** the next prompt augments the user's prompt with a directive to reassess and take a different approach

#### Scenario: normal progress is not disturbed
- **WHEN** the previous iteration made tool calls and produced substantive new output
- **THEN** the next prompt is the user's prompt unchanged

### Requirement: pausing a loop costs nothing
A paused loop's driver fiber SHALL block on a signal that resume resolves, rather than
polling on a timer. Resuming SHALL wake the fiber without waiting for a poll interval.

#### Scenario: a paused loop consumes no scheduler capacity
- **WHEN** a loop is paused for an extended period
- **THEN** its driver fiber performs no periodic work while paused

#### Scenario: resume takes effect immediately
- **WHEN** a paused loop is resumed
- **THEN** the next iteration begins without waiting out a polling interval
