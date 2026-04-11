# apn-relay Agent Guide

This file defines package-specific guidance for agents working in `packages/apn-relay`.

## Scope And Precedence

- Follow root `AGENTS.md` first.
- This file provides stricter package-level conventions for relay service work.
- If future local guides are added, closest guide wins.

## Project Overview

- Minimal APNs relay service (Hono + Bun + PlanetScale via Drizzle).
- Core routes:
  - `GET /health`
  - `GET /`
  - `POST /v1/device/register`
  - `POST /v1/device/unregister`
  - `POST /v1/event`

## Commands

Run all commands from `packages/apn-relay`.

- Install deps: `bun install`
- Start relay locally: `bun run dev`
- Typecheck: `bun run typecheck`
- DB connectivity check: `bun run db:check`

## Build / Test Expectations

- There is no dedicated package test script currently.
- Required validation for behavior changes:
  - `bun run typecheck`
  - `bun run db:check` when DB/env changes are involved
  - manual endpoint verification against `/health`, `/v1/device/register`, `/v1/event`

## Single-Test Guidance

- No single-test command exists for this package today.
- For focused checks, run endpoint-level manual tests against a local dev server.

## Code Style Guidelines

### Formatting / Structure

- Keep handlers compact and explicit.
- Prefer small local helpers for repeated route logic.
- Avoid broad refactors when a targeted fix is enough.

### Types / Validation

- Validate request bodies with `zod` at route boundaries.
- Keep payload and DB row shapes explicit and close to usage.
- Avoid `any`; narrow unknown input immediately after parsing.

### Naming

- Follow existing concise naming in this package (`reg`, `unreg`, `evt`, `row`, `key`).
- For DB columns, keep snake_case alignment with schema.

### Error Handling

- Return clear JSON errors for invalid input.
- Keep handler failures observable via `app.onError` and structured logs.
- Do not leak secrets in responses or logs.

### Logging

- Log delivery lifecycle at key checkpoints:
  - registration/unregistration attempts
  - event fanout start/end
  - APNs send failures and retries
- Mask sensitive values; prefer token suffixes and metadata.

### APNs Environment Rules

- Keep APNs env explicit per registration (`sandbox` / `production`).
- For `BadEnvironmentKeyInToken`, retry once with flipped env and persist correction.
- Avoid infinite retry loops; one retry max per delivery attempt.

## Database Conventions

- Schema is in `src/schema.sql.ts`.
- Keep table/column names snake_case.
- Maintain index naming consistency with existing schema.
- For upserts, update only fields required by current behavior.

## API Behavior Expectations

- `register`/`unregister` must be idempotent.
- `event` should return success envelope even when no devices are registered.
- Delivery logs should capture per-attempt result and error payload.

## Operational Notes

- Ensure `APNS_PRIVATE_KEY` supports escaped newline format (`\n`) and raw multiline.
- Validate that `APNS_DEFAULT_BUNDLE_ID` matches mobile app bundle identifier.
- Avoid coupling route behavior to deployment platform specifics.

## Before Finishing

- Run `bun run typecheck`.
- If DB/env behavior changed, run `bun run db:check`.
- Manually exercise affected endpoints.
- Confirm logs are useful and secret-safe.
