## ADDED Requirements

### Requirement: live subagents of the current session SHALL be listable

A `/nudge` invocation with no arguments SHALL list the subagent sessions currently live
under the session it is issued from, identifying each by a stable index for this listing,
its agent name, and the task it was given.

Only children of the current session SHALL be listed. Sessions elsewhere in the instance
MUST NOT be addressable this way.

#### Scenario: live children are listed

- **WHEN** `/nudge` is issued in a session with two live subagents
- **THEN** both are listed with an index, agent name, and task description

#### Scenario: nothing to steer

- **WHEN** `/nudge` is issued in a session with no live subagents
- **THEN** it reports that there is nothing to steer and sends no message

### Requirement: a steer SHALL be delivered to a running subagent's own session

`/nudge <text>` SHALL append the text to a live subagent's session as user input.

When exactly one subagent is live, it SHALL be the target. When more than one is live, a
target SHALL be required as an index or agent name, and an ambiguous or absent target
SHALL produce the listing instead of a delivery. A steer MUST NOT be redirected to the
parent session when the intended target cannot be resolved.

The text SHALL be delivered to a subagent that is mid-turn once that turn completes,
rather than being dropped or interrupting the turn in progress. The result SHALL report
delivery, not completion.

#### Scenario: the only live child is the implied target

- **WHEN** `/nudge look at the Effect layer wiring first` is issued and one subagent is live
- **THEN** the text is appended to that subagent's session and the result reports it as delivered

#### Scenario: ambiguity lists rather than guesses

- **WHEN** a steer with no target is issued and two subagents are live
- **THEN** no message is delivered and the live subagents are listed

#### Scenario: a steer is never redirected to the parent

- **WHEN** a steer names a target that is not a live child of this session
- **THEN** no message is delivered to any session and the failure is reported

#### Scenario: a mid-turn child receives the steer after its turn

- **WHEN** a steer targets a subagent that is currently producing a turn
- **THEN** the text is queued onto that subagent's session and delivered when the turn completes

### Requirement: steering MUST NOT cancel a running loop

`/nudge` SHALL be treated as run control. Issuing it while a loop drives the session MUST
NOT cancel the loop or abort the session, in the same way `/loop`, `/auto`, and `/btw` do
not.

`/btw` SHALL keep its existing behaviour unchanged: a side question answered from context,
using no tools, never joining the conversation and never delivered to a subagent.

#### Scenario: a steer leaves the run alone

- **WHEN** `/nudge <text>` is issued while a queue loop is running
- **THEN** the loop remains running and the session is not aborted

#### Scenario: `/btw` is not a steer

- **WHEN** `/btw <question>` is issued while a subagent is live
- **THEN** the question is answered from the current session's context and nothing is delivered to the subagent
