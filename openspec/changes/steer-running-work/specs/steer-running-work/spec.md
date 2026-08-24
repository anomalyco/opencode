## ADDED Requirements

### Requirement: a running loop SHALL accept a correction without being cancelled

A running or paused loop SHALL accept operator text that is carried into its subsequent
iterations.

The correction SHALL be applied to every iteration after the one in flight, not only the
next one, so that an instruction given once is not forgotten on the iteration after. The
in-flight iteration SHALL NOT be interrupted, and the result SHALL report that the
correction applies from the following iteration rather than claiming it took effect.

Corrections SHALL accumulate in the order given, alongside any standing guidance the run
started with.

#### Scenario: a correction reaches the next iteration

- **WHEN** `/nudge leave the CLI alone` is issued against a running loop
- **THEN** the next iteration's prompt contains that text

#### Scenario: a correction persists beyond the next iteration

- **WHEN** two further iterations run after a correction is issued
- **THEN** both of their prompts contain it

#### Scenario: several corrections accumulate

- **WHEN** two corrections are issued in sequence
- **THEN** a later iteration's prompt contains both, in the order they were given

#### Scenario: the in-flight iteration is left alone

- **WHEN** a correction is issued while an iteration is mid-turn
- **THEN** that turn completes normally and the result says the correction applies from the next iteration

### Requirement: steering MUST work in both loop modes

A correction SHALL reach the model in queue mode and in prompt mode alike.

Both rebuild their prompt from the loop record on every iteration, so appending to the
record is the delivery mechanism. Delivery MUST NOT depend on injecting into a turn that is
already running.

#### Scenario: a queue run carries the correction

- **WHEN** a correction is issued against a queue loop
- **THEN** the next iteration's brief contains it

#### Scenario: a prompt loop carries the correction

- **WHEN** a correction is issued against a prompt loop
- **THEN** the next iteration's prompt contains it alongside the original prompt

### Requirement: steering MUST NOT cancel or replace the run

Issuing a correction MUST NOT cancel the loop, abort the session, or be sent as an ordinary
message.

When there is no running loop to steer, the attempt SHALL report that and deliver nothing.
It MUST NOT fall back to sending the text as a normal prompt: a steer that silently becomes
a message can cancel the very run it was meant to preserve.

#### Scenario: the run survives being steered

- **WHEN** a correction is issued while a loop is running
- **THEN** the loop is still running afterwards and the session was not aborted

#### Scenario: nothing to steer

- **WHEN** a correction is issued with no running loop in the session
- **THEN** nothing is delivered and the result says there is no running loop

### Requirement: `/btw` and `/nudge` SHALL remain distinct verbs

`/btw` SHALL continue to answer a question from the current context, using no tools, without
joining the conversation and without affecting any running work.

A correction MUST NOT be answerable as a question, and a question MUST NOT be injected into
a run's instructions. The two differ in whether what was typed persists, and that property
MUST NOT depend on what happens to be running.

#### Scenario: `/btw` does not steer

- **WHEN** `/btw what was that file called?` is issued while a loop is running
- **THEN** the question is answered from context and no iteration's prompt contains it

#### Scenario: `/nudge` is not answered as a question

- **WHEN** a correction is issued
- **THEN** it is recorded for subsequent iterations rather than answered
