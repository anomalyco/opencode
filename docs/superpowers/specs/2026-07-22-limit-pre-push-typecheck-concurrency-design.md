# Limit pre-push typecheck concurrency

## Problem

The repository's Husky `pre-push` hook runs `bun typecheck`, which expands to `bun turbo typecheck`. On the two-CPU, 3.8 GiB server, Turbo launched ten `tsgo` workers while checking 35 packages. Those workers exhausted RAM and swap and triggered the OOM killer.

## Decision

Change only `.husky/pre-push` to invoke Turbo directly with a concurrency limit:

```sh
bun turbo typecheck --concurrency=3
```

This keeps the existing typecheck task graph while allowing at most three parallel tasks during a push. The global `typecheck` package script remains unchanged, so local and CI callers retain their current behavior.

## Alternatives considered

- Add `--concurrency=3` to the root `typecheck` package script. Rejected because it changes every caller, not only the problematic push hook.
- Set `TURBO_CONCURRENCY=3` in the hook environment. Rejected because the effective limit is less visible than an explicit CLI argument.

## Validation

1. Before editing, verify the hook does not contain the required limited command.
2. After editing, verify the hook contains exactly `bun turbo typecheck --concurrency=3` and no unrestricted `bun typecheck` invocation.
3. Run the hook through `sh -n`.
4. Run Turbo with `--dry` and `--concurrency=3` to validate argument parsing without starting package typechecks.

## Out of scope

This change does not alter systemd services, OpenCode memory limits, CI behavior, or the root `typecheck` script.
