# DECISION_152 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_152_AUTH_VAULT_LINKAGE_KEYGEN_AND_ENCRYPTED_AGENTIC_EXPANSION.md`

## Assimilated Truth

- Auth-vault linkage drift can happen when index locators reference older workspace roots; a built-in `doctor` repair command closes that gap quickly.
- Agentic secret coverage should include API keys and generic encrypted records in addition to password/bearer/oauth to avoid ad-hoc plaintext storage.
- `generate-key` needs to support role-targeted issuance (for example Alma) while defaulting to encrypted-at-rest DPAPI handling.
- Auth-vault writes must be serialized; parallel writes can race on `index.json` and drop records.

## Reusable Anchors

- `auth vault doctor locator repair nate alma`
- `generate encrypted key for alma agent`
- `api key + generic encrypted secret auth vault`
- `auth vault index race parallel writes`

## Evidence Paths

- `OP3NF1XER/nate-alma/dev/skills/auth-vault/scripts/vault.py`
- `OP3NF1XER/nate-alma/dev/skills/auth-vault/SKILL.md`
- `OP3NF1XER/nate-alma/dev/AGENTS.md`
- `OP3NF1XER/nate-alma/dev/.secrets/auth-vault/index.json`
- `OP3NF1XER/patterns/AUTH_VAULT_MUTATION_SERIALIZATION.md`
- `OP3NF1XER/deployments/JOURNAL_2026-02-25_DECISION_152_AUTH_VAULT_LINKAGE_KEYGEN_ENCRYPTION.md`
