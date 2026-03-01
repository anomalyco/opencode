# Pattern: Auth Vault Mutation Serialization

## Trigger

Any pass that writes multiple records into `skills/auth-vault/scripts/vault.py` in one execution window.

## Risk

Parallel write commands can race on `index.json` and lose entries because each command reads/writes full index state.

## Mandatory Sequence

1. Run write operations sequentially (not in parallel).
2. After writes, run `python skills/auth-vault/scripts/vault.py list`.
3. Run `python skills/auth-vault/scripts/vault.py doctor` to validate locator consistency.
4. If an entry is missing, re-run the missing write command and re-verify.

## Evidence Rule

Capture command outputs showing expected entry count and record names in deployment journal.

## Closure Rule

Do not close while expected secret records are absent from `index.json` or locator doctor reports unresolved drift.
