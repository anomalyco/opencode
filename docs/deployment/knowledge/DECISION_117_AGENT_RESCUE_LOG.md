# DECISION_117 Agent Rescue Log

## Objective

Recover damaged active agent prompts from backup while preserving repaired Strategist and OpenFixer prompts.

## Rescue Sequence

1. Enumerated active agents and backup agents under:
   - `C:/Users/paulc/.config/opencode/agents`
   - `C:/Users/paulc/.config/opencode/agents/.backups/agents`
2. Verified Strategist and OpenFixer as protected repair anchors.
3. Restored non-anchor prompts from backup:
   - `designer.md`, `explorer.md`, `fixer.md`, `forgewright.md`, `librarian.md`, `oracle.md`, `orchestrator.md`, `windfixer.md`
4. Re-applied active authority guard (`Agent Source Of Truth`) across agents.
5. Added OpenFixer command-authority and caller-identity rules.

## Decision Thread References

- DECISION_087
- DECISION_114
- DECISION_115
- DECISION_116
- DECISION_117

## Outcome

Rescue complete. Prompt thread recovered from backups and authority controls reinstated.
