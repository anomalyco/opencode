# Skills Prompt Injection Evaluation Spec

## Purpose

Determine which skill description injection level produces the highest **skill discovery rate** for Qwen 3.6 (via `llama.cpp/qwen3.6`). This evaluation isolates Qwen 3.6 — no cross-model comparison.

## Background

OpenCode currently injects skill descriptions in **3 places** per session:

1. **System prompt** — `<available_skills>` block in the initial system message
2. **Tool description** — The `skill` tool's description field (sent via the `tools` API parameter)
3. **System reminder** — `<dcp-system-reminder>` tags injected during the session

This "belt-and-suspenders" approach was designed because models were observed to not always read tool descriptions proactively (issue #15652). However, this wastes ~5-7K tokens per session and may not be optimal for Qwen 3.6 specifically.

## Config

```yaml
skills:
  prompt_injection: "triple" | "dual" | "single" | "none"
```

## Injection Levels

| Config | System Prompt | Tool Description | System Reminder | Est. Token Cost |
|--------|--------------|------------------|-----------------|-----------------|
| `triple` | ✓ | ✓ | ✓ | ~5-7K |
| `dual` | — | ✓ | ✓ | ~3-4K |
| `single` | — | ✓ | — | ~1-2K |
| `none` | — | — | — | ~0 |

## Primary Metric: Skill Discovery Rate

**Definition:** The percentage of tasks where Qwen 3.6 invokes at least one of the expected skills.

**Formula:**
```
discovery_rate = (tasks_with_skill_invocation / total_tasks) * 100
```

**Measurement:**
- Each task has a ground-truth set of expected skills
- After running a task, compare actual skill invocations against expected skills
- A task "succeeds" if at least one expected skill was invoked

## Secondary Metrics

### Token Cost Per Session
- Direct token count from the API response
- Measures efficiency of each injection level

### False Positive Rate
- Percentage of tasks where Qwen 3.6 invoked a skill that was NOT in the expected set
- High false positive rate suggests the model is confused by redundant skill descriptions

### Time to First Skill Call
- Number of steps (model turns) before the first skill invocation
- Measures how quickly the model recognizes and acts on skill availability

## Test Design

### Task Structure

Each task is defined in a JSON/YAML file with:

```json
{
  "id": "task-001",
  "description": "Natural language task description",
  "expected_skills": ["hypothesis-debugging", "critical-thinking-patterns"],
  "category": "debugging"
}
```

### Task Categories (TBD)

Tasks should span multiple categories to test different skill discovery patterns:

- **Debugging** — Tasks requiring systematic debugging approaches
- **Code Review** — Tasks requiring review patterns and anti-patterns
- **Architecture** — Tasks requiring design patterns and decision frameworks
- **Configuration** — Tasks requiring config file manipulation
- **Research** — Tasks requiring web search and information gathering

### Evaluation Procedure

1. Define N tasks (minimum 10, target 20+)
2. Run each task with each of the 4 configs (A/B/C/D)
3. Record: skill invocations, token count, steps to first skill call, false positives
4. Aggregate results by config
5. Compare discovery rates and secondary metrics

### Statistical Considerations

- Run each config-task pair at least 3 times (Qwen 3.6 may have non-deterministic behavior)
- Randomize task order within each config run
- Report mean ± standard deviation for all metrics

## Expected Outcomes (Hypotheses)

| Hypothesis | Prediction |
|-----------|------------|
| H1 | `single` (tool description only) achieves ≥90% of `triple`'s discovery rate |
| H2 | `single` uses ~70% fewer tokens than `triple` |
| H3 | `triple` has higher false positive rate than `single` |
| H4 | `none` achieves <50% discovery rate (skills are overlooked without reinforcement) |

## Deliverables

- [ ] Task definition file (JSON/YAML)
- [ ] Evaluation runner script
- [ ] Results spreadsheet with per-task and aggregated metrics
- [ ] Recommendation: which config to use as default for Qwen 3.6

## Open Questions

- What is the minimum viable task count for statistically meaningful results?
- Should we include a "no skills available" baseline task?
- How do we handle tasks where multiple skills could be correct?
