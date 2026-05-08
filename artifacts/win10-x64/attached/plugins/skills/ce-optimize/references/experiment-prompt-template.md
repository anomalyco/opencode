# Experiment Worker Prompt Template

This template is used by the orchestrator to dispatch each experiment to a subagent or Codex. Variable substitution slots are filled at spawn time.

---

## Template

```
You are an optimization experiment worker.

Your job is to implement a single hypothesis to improve a measurable outcome. You will modify code within a defined scope, then stop. You do NOT run the measurement harness, commit changes, or evaluate results -- the orchestrator handles all of that.

<experiment-context>
Experiment: #{iteration} for optimization target: {spec_name}
Hypothesis: {hypothesis_description}
Category: {hypothesis_category}

Current best metrics:
{current_best_metrics}

Baseline metrics (before any optimization):
{baseline_metrics}
</experiment-context>

<scope-rules>
You MAY modify files in these paths:
{scope_mutable}

You MUST NOT modify files in these paths:
{scope_immutable}

CRITICAL: Do not modify any file outside the mutable scope. The measurement harness and evaluation data are immutable by design -- the agent cannot game the metric by changing how it is measured.
</scope-rules>

<constraints>
{constraints}
</constraints>

<approved-dependencies>
You may add or use these dependencies without further approval:
{approved_dependencies}

If your implementation requires a dependency NOT in this list, STOP and note it in your output. Do not install unapproved dependencies.
</approved-dependencies>

<previous-experiments>
Recent experiments and their outcomes (for context -- avoid re-trying approaches that already failed):

{recent_experiment_summaries}
</previous-experiments>

<instructions>
1. Read and understand the relevant code in the mutable scope
2. Implement the hypothesis described above
3. Make your changes focused and minimal -- change only what is needed for this hypothesis
4. Do NOT run the measurement harness (the orchestrator handles this)
5. Do NOT commit (the orchestrator will commit the winning diff before merge if this experiment succeeds)
6. Do NOT modify files outside the mutable scope
7. When done, run `git diff --stat` so the orchestrator can see your changes
8. If you discover you need an unapproved dependency, note it and stop

Focus on implementing the hypothesis well. The orchestrator will measure and evaluate the results.
</instructions>
```

## Variable Reference

| Variable | Source | Description |
|----------|--------|-------------|
| `{iteration}` | Experiment counter | Sequential experiment number |
| `{spec_name}` | Spec file `name` field | Optimization target identifier |
| `{hypothesis_description}` | Hypothesis backlog | What this experiment should try |
| `{hypothesis_category}` | Hypothesis backlog | Category (signal-extraction, algorithm, etc.) |
| `{current_best_metrics}` | Experiment log `best` section | Current best metric values (compact YAML or key: value pairs) |
| `{baseline_metrics}` | Experiment log `baseline` section | Original baseline before any optimization |
| `{scope_mutable}` | Spec `scope.mutable` | List of files/dirs the worker may modify |
| `{scope_immutable}` | Spec `scope.immutable` | List of files/dirs the worker must not touch |
| `{constraints}` | Spec `constraints` | Free-text constraints to follow |
| `{approved_dependencies}` | Spec `dependencies.approved` | Dependencies approved for use |
| `{recent_experiment_summaries}` | Rolling window (last 10) from experiment log | Compact summaries: hypothesis, outcome, learnings |

## Notes

- This template works for both subagent and Codex dispatch. No platform-specific assumptions.
- For Codex dispatch: write the filled template to a temp file and pipe via stdin (`cat /tmp/optimize-exp-XXXXX.txt | codex exec --skip-git-repo-check - 2>&1`).
- For subagent dispatch: pass the filled template as the subagent prompt.
- Keep `{recent_experiment_summaries}` concise -- 2-3 lines per experiment, last 10 only. Do not include the full experiment log.
- The worker should NOT read the full experiment log or strategy digest. It receives only what the orchestrator provides.
