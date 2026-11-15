# Provider-aware API key format validation

## Goal

Implement issue #64023 by rejecting obviously malformed credentials only when a provider declares a stable, documented local format. Keep live credential verification out of scope.

## Repository findings

- `Integration.KeyMethod` is the shared method contract exposed by the schema and plugin API.
- `Integration.connection.key` is the shared persistence boundary used by App, TUI, CLI, and SDK paths.
- Catalog-backed providers are registered as key methods by `ModelsDevPlugin`.
- Credential creation happens after the method and form validation in `packages/core/src/integration.ts`.

## Design

1. Add optional declarative prefix metadata to key methods. Omitted metadata means the key remains opaque.
2. Reject empty/whitespace-only values for all key methods in core.
3. Enforce a declared prefix before form validation and credential creation; do not include the submitted key in errors.
4. Declare only the documented Anthropic `sk-ant-` prefix for catalog-backed provider login. Do not infer a format from provider naming or apply a global `sk-` rule.
5. Test a valid constrained key, malformed constrained key, whitespace-only input, opaque provider acceptance, and no credential mutation after rejection.

## Verification

- Run the focused core integration test repeatedly with the repository's unit-test guidance.
- Run the core package test suite and relevant type/lint checks.
- Inspect the final diff for secret disclosure, accidental validation of unconstrained providers, and mutation before validation.
- Confirm upstream CI before requesting review.

## Current environment limitation

The connected GitHub API can read and write the fork, but local Git clone is unavailable because this execution environment cannot resolve `github.com`. The GitHub integration also rejects creating a pull request against the upstream repository with `Resource not accessible by integration`. Do not represent tests or CI as passing until they have actually run.
