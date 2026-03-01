# DECISION_155 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_155_DOCTRINE_BIBLE_WEB_MODERNIZATION_AND_AGENTIC_SETUP_SCOPE.md`

## Assimilated Truth

- A textbook-style doctrine site benefits most from a docs-first split layout: left chapter tree, center lesson body, right utility rail.
- For dense educational repos, layout choice should optimize hierarchy + retrieval speed before adding visual complexity.
- `/setup` surface parity must be explicitly inventoried during planning so UI modernization does not hide operational controls.
- Secret provisioning for site auth should use auth-vault records with named helper scripts, not ad-hoc shell snippets.

## Reusable Anchors

- `doctrine bible docs-first split layout`
- `docusaurus-style hierarchy with mkdocs/nextra search ergonomics`
- `setup endpoint parity inventory before website redesign`
- `auth-vault helper script for human login rotation`

## Evidence Paths

- `OP3NF1XER/nate-alma/dev/skills/auth-vault/scripts/update_bible_login.py`
- `OP3NF1XER/nate-alma/dev/.secrets/auth-vault/index.json`
- `OP3NF1XER/nate-alma/dev/skills/auth-vault/SKILL.md`
- `OP3NF1XER/nate-alma/dev/TOOLS.md`
