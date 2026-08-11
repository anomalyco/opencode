## ADDED Requirements

### Requirement: persona definitions are tracked files, never symlinks into `.skein/`

Agent definitions under `.opencode/agent/` SHALL be regular files tracked in git. They
MUST NOT be symlinks into any `.skein/` directory, in this repo or any other.

A `.skein/` directory is local per-repo state — changes, worktrees, chat sessions, and
that repo's own possibly-customised agents. It is not a shared library. Skein's
`templates/agents/` may be used as a source to copy and adapt from; the copy is what is
committed.

#### Scenario: no dangling agent definitions

- **WHEN** the agent definitions under `.opencode/agent/` are enumerated
- **THEN** every entry resolves to a readable regular file
- **AND** no entry is a symbolic link

#### Scenario: definitions survive a repo rename or move

- **WHEN** the repository directory is renamed or moved
- **THEN** every agent under `.opencode/agent/` still loads

### Requirement: the persona set covers the roles the queue's gates need

The repository SHALL ship agent definitions for `coder`, `tester`, `reviewer`,
`researcher`, and `persona-auditor`, each declaring `mode: subagent` and a `description`
that states what it is an expert at.

Persona prompts SHALL be written against this repository's actual stack and commands —
Bun, TypeScript, Effect-TS, openspec changes, `bun run typecheck`, `bun test` — and MUST
NOT instruct the agent to read or write paths that do not exist here.

#### Scenario: every gate role is available for delegation

- **WHEN** the agent registry is listed
- **THEN** `coder`, `tester`, and `reviewer` are present as subagents

#### Scenario: a persona does not reference a foreign codebase

- **WHEN** a shipped persona prompt is read
- **THEN** it does not instruct the agent to inspect Go sources or to write into `.skein/`

### Requirement: a persona's permissions MUST match what its prompt tells it to do

Each persona's `permission` block SHALL grant what its instructions require and deny what
its role forbids.

Specifically: an agent whose role is to review or audit without changing anything SHALL be
denied `write` and `edit`, and an agent whose role is to run tests SHALL be allowed
`bash`. A persona that is told to do something it is denied the permission for is a
configuration bug that presents as a model failure, which is why it is pinned here.

#### Scenario: a reviewer cannot edit what it reviews

- **WHEN** the `reviewer` or `persona-auditor` definition is loaded
- **THEN** its permission ruleset denies `write` and denies `edit`

#### Scenario: a tester can run the test suite

- **WHEN** the `tester` definition is loaded
- **THEN** its permission ruleset allows `bash`

### Requirement: an auditor SHALL judge a persona against its own stated description

A `persona-auditor` subagent SHALL read an agent definition and report whether the prompt
would make a competent expert at the `description` that definition claims.

The audit SHALL cover: whether the instructions are specific enough to act on, whether the
permission block is coherent with the instructions, whether the prompt references files,
commands, or conventions that do not exist in this repository, and whether the persona
overlaps another in the set to the point of ambiguity. It SHALL emit findings and a
verdict of `LGTM` or `NEEDS_WORK`.

#### Scenario: an incoherent persona is caught

- **WHEN** the auditor is given a persona instructed to run tests but denied `bash`
- **THEN** it reports a permission-versus-instruction conflict and returns `NEEDS_WORK`

#### Scenario: a stale reference is caught

- **WHEN** the auditor is given a persona instructed to write to a path absent from the repo
- **THEN** it reports the missing path and returns `NEEDS_WORK`

#### Scenario: the audit has actually been run

- **WHEN** this change is complete
- **THEN** each shipped persona has been audited and the findings recorded in `tasks.md`
