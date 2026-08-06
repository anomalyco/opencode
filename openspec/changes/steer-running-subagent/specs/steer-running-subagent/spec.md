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

The text SHALL be delivered **between steps of the running turn** — appended to the
subagent's message history so its next model call sees it — rather than after the turn or
by interrupting the step in flight. The result SHALL report delivery, not completion.

"After the turn completes" is not an acceptable delivery point and MUST NOT be
implemented. For a one-shot subagent the end of the turn is the end of the subagent: the
parent has already taken its result, and a steer delivered then starts an orphaned turn
nobody is waiting on. Steering has to reach the agent while it is still working or it does
nothing.

Prompting a session whose runner is already `Running` MUST NOT be used as the delivery
mechanism. `Runner.ensureRunning` joins the in-flight run and discards the submitted work,
so a steer sent that way is silently lost.

#### Scenario: a steer reaches the agent before its next step

- **WHEN** a steer targets a subagent that is between tool calls in a running turn
- **THEN** the text is present in the message history the subagent's next model call receives

#### Scenario: a steer is never delivered by re-prompting a busy session

- **WHEN** a steer targets a subagent whose runner is running
- **THEN** delivery does not go through the ordinary prompt path for that session

#### Scenario: the only live child is the implied target

- **WHEN** `/nudge look at the Effect layer wiring first` is issued and one subagent is live
- **THEN** the text is appended to that subagent's session and the result reports it as delivered

#### Scenario: ambiguity lists rather than guesses

- **WHEN** a steer with no target is issued and two subagents are live
- **THEN** no message is delivered and the live subagents are listed

#### Scenario: a steer is never redirected to the parent

- **WHEN** a steer names a target that is not a live child of this session
- **THEN** no message is delivered to any session and the failure is reported

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
