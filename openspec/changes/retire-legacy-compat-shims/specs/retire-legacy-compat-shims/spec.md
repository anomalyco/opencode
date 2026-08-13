## ADDED Requirements

### Requirement: divergence from upstream MUST be either a registered feature or absent

A source file that differs from the upstream baseline SHALL either be registered in
`fork/manifest.json` (as `owned` or `patched`) or be reverted to upstream. This applies
to every file under `packages/*/src` and `packages/*/test`.

There is no third category. A local copy that exists only because upstream moved is
drift, and drift SHALL be deleted in favour of upstream's implementation. Drift is more
dangerous than dead code: it compiles and runs, so it is discovered by a broken sync
rather than by a reader.

#### Scenario: an unregistered divergence is caught before it ships

- **WHEN** `bun run fork:verify` runs on a tree where a source file differs from the
  upstream baseline and has no `fork/manifest.json` entry
- **THEN** it fails and names the file

#### Scenario: a registered fork feature survives a sync

- **WHEN** a sync completes and `bun run fork:verify` runs
- **THEN** it reports every `owned` file present and every `patched` marker intact

### Requirement: a compatibility shim for a deleted upstream module MUST NOT be introduced

When upstream deletes or replaces a module the fork depends on, the fork SHALL migrate
its callers to the upstream replacement. It SHALL NOT re-implement the deleted module at
its original import path to avoid the migration.

Re-implementing is attractive during a sync because it converts many small edits into one
file. That trade is rejected here: the shim never gets retired on its own, it hides the
migration from every future reader, and it silently freezes the fork on an API upstream
has abandoned.

#### Scenario: upstream removes a module the fork uses

- **WHEN** a sync reveals that fork code imports a module upstream has deleted
- **THEN** the fork's callers are migrated to upstream's replacement in the same change
- **AND** no file is created at the deleted module's import path

#### Scenario: the legacy logger is gone

- **WHEN** the repository is searched for imports of `@opencode-ai/core/util/log`
- **THEN** there are none, and `packages/core/src/util/log.ts` does not exist

### Requirement: the typecheck gate MUST be green so that it gates

`bun run typecheck` SHALL pass on `dev`.

A gate that is known-red gates nothing — it trains readers to skip it, and it lets a new
error hide among the accepted ones. The 2026-08-11 sync shipped a tree with ~260
typecheck errors and a working binary, which is precisely the state in which the next
regression is invisible.

#### Scenario: a new type error is visible

- **WHEN** a change introduces a type error
- **THEN** `bun run typecheck` fails, and the failure is attributable to that change

### Requirement: dependency versions MUST come from upstream unless the fork records otherwise

The `catalog` and `patchedDependencies` blocks in the root `package.json` SHALL match the
upstream baseline, except for entries the fork explicitly records as its own.

A merge that resolves `package.json` as "ours" silently reverts upstream's dependency
work. This is not a hypothetical: it downgraded opentui 0.4.5 → 0.3.4 and effect
beta.83 → beta.74, which broke the build in four places and crashed the binary during
schema construction.

#### Scenario: a sync does not revert upstream dependency bumps

- **WHEN** a sync merges upstream into the fork
- **THEN** the resulting `catalog` differs from upstream only by fork-recorded entries
