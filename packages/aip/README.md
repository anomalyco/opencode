# @daemon-protocol/aip

An **AIP-style architecture** (à la Palantir Foundry AIP) for daemoncode — a
semantic ontology over the agent's own world, governed "kinetic" actions, and a
dynamic learn-from-outcome layer. It mostly **composes existing daemoncode
machinery** rather than reinventing it.

## Pipeline

```
User query
 → Semantic layer      (Objects: Session, Skill, Tool, Agent + typed links)   objects.ts / ontology.ts
 → Graph traversal     (relations between objects)                            graph.ts
 → Kinetic layer       (governed actions available on objects)                actions.ts
 → LLM proposes        (pick an action/answer over the subgraph)              propose.ts
 → Action branch → review → merge ── WRITE BACK                               governance.ts
 → Dynamic layer learns from outcome → updates ontology                       dynamic.ts
```

## How it maps to the repo

| AIP concept | daemoncode mechanism it reuses |
| --- | --- |
| Objects (Session/Skill/Tool/Agent) | `packages/core/src/session`, `…/skill`, `…/agent`, `packages/opencode/src/session/tools.ts` |
| Action branch → human review → merge | `Permission.ask/reply` (`packages/opencode/src/permission`) via `PermissionReviewer` |
| Outcomes that feed learning | session events (`Step.Ended`, `Tool.Success/Failed`, `ACE.Decision`) shaped as an evolve `Dataset` |
| Learn-from-outcome → propose change | `evolveSkill` from `@opencode-ai/evolve` |
| Write-back diff | `lineDiff` from `@opencode-ai/evolve` |

Actions are **governed**: `propose()` returns a `ProposedChange` and never mutates
state — application happens only after `review` → `merge`. Skill rewrites stage a
diff and (optionally) write the file; promotion still goes through the repo's PR +
`bun test` gate.

## Usage

```bash
# Full pipeline, offline (deterministic mock model — no credentials needed):
bun run packages/aip/src/cli.ts query "improve the git-commit skill" --mock \
  --skill   packages/evolve/examples/skills/git-commit/SKILL.md \
  --dataset packages/evolve/examples/datasets/git-commit.json
```

Output walks each stage: the traversed subgraph → proposed action → branch
review/merge → dynamic learning (e.g. `evolve git-commit: pass 25% → 100%`,
ontology `passRate` updated, a governed `update-skill` branch staged).

With `ANTHROPIC_API_KEY` set (and optionally `ANTHROPIC_BASE_URL`) the proposer
and learner use the real model instead of the offline mock.

## Programmatic

```ts
import { createOntology, obj, expand, defaultActions, propose, AutoReviewer, review, merge, learn } from "@daemon-protocol/aip"
```

## Tests

```bash
bun test packages/aip   # 31 tests: ontology, graph, actions, propose, governance, dynamic
```
