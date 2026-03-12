---
name: pennylane
description: Use this when working with Pennylane data or the Pennylane API. Prefer the built-in pennylane_* plugin tools for supported read-only operations, and fall back to raw API requests only for unsupported endpoints or explicitly approved write operations.
---

## Use this when

- The user wants to inspect Pennylane accounts, journals, ledger entries, transactions, bank accounts, or fiscal years
- The user wants to verify Pennylane authentication
- The user wants to work with Pennylane data but a matching `pennylane_*` tool may or may not exist yet

## Tool-first workflow

For supported read-only operations, use the matching Pennylane plugin tool instead of writing shell commands manually.

Available tool surface:

- `pennylane_health`
- `pennylane_me`
- `pennylane_ledger_accounts_list`
- `pennylane_ledger_accounts_get`
- `pennylane_ledger_entries_list`
- `pennylane_ledger_entries_get`
- `pennylane_journals_list`
- `pennylane_journals_get`
- `pennylane_transactions_list`
- `pennylane_transactions_get`
- `pennylane_bank_accounts_list`
- `pennylane_bank_accounts_get`
- `pennylane_fiscal_years_list`

When a matching tool exists, use it first.

## Authentication

- The plugin-backed Pennylane tools expect `PENNYLANE_API_KEY` in the environment.
- If `pennylane` is not on `PATH`, set `PENNYLANE_CLI_BIN` to the full binary path.
- Use `pennylane_health` to verify access.
- Use `pennylane_me` when the authenticated user payload is needed.

If the API key is missing, tell the user:

```bash
export PENNYLANE_API_KEY=your_key_here
```

## Fallback API usage

Use raw API requests only when:

- no matching `pennylane_*` tool exists
- the user explicitly asks for an unsupported endpoint
- you are debugging the Pennylane API itself

For write operations, always confirm with the user before proceeding.

Base URL:

```text
https://app.pennylane.com/api/external/v2
```

Auth header:

```text
Authorization: Bearer $PENNYLANE_API_KEY
```

When using `curl`, never pipe the Pennylane response directly to `jq`. Capture the response first:

```bash
response=$(curl -s -H "Authorization: Bearer $PENNYLANE_API_KEY" \
  "https://app.pennylane.com/api/external/v2/me") && echo "$response" | jq .
```

## Operating rules

- Treat Pennylane data as sensitive financial data.
- Confirm before any write operation.
- Prefer supported tool calls over custom shell commands.
- If a tool call fails, surface the CLI error clearly instead of inventing a result.
