# system-understanding-agent

Part of the **Agile V + Understand Anything** integration.

This skill implements **Gate 0** of the integrated Agile V lifecycle. It consumes an Understand
Anything knowledge graph and produces a reviewable system overview before any requirements are
generated or code is written.

## Quick start

1. Run Understand Anything on your repository to generate the knowledge graph:

   ```bash
   understand --repo .
   ```

2. Activate this skill in your agent and provide the change request:

   ```text
   Load skills/system-understanding-agent/SKILL.md
   Change request: <your change description>
   ```

3. Review the outputs in `.agile-v/understanding/`.

4. Confirm Gate 0 and proceed to `impact-analysis-agent`.

## Key outputs

| File | Purpose |
|---|---|
| `system_overview.md` | Plain-English summary of the system |
| `architecture_map.md` | Layer and component map |
| `domain_flow_summary.md` | Business domain flows |
| `understanding_gate_decision.md` | Gate 0 decision record |

## See also

- `SKILL.md` — full skill specification
- `metadata.json` — machine-readable skill metadata
- `examples/` — sample inputs and outputs
- `tests/` — activation and negative test cases
- `../impact-analysis-agent/` — next skill in the pipeline
