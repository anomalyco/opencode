# Reporting format

Use this exact structure when reporting an Autoloop run. Keep it concise and
factual — numbers first, prose second.

## Run summary template

```markdown
## Autoloop run: <program>

**Baseline score:** <float>
**Final score:** <float>
**Improvement:** <+/-float> (<percent>%)
**Iterations run:** <n> / <max>
**Accepted changes:** <k>
**Target reached:** <yes|no|n-a>

### Iteration log

| # | Hypothesis | Old score | New score | Result |
|---|------------|-----------|-----------|--------|
| 1 | ...        | ...       | ...       | kept / reverted |
| 2 | ...        | ...       | ...       | kept / reverted |

### What changed

- Bullet the accepted algorithmic/heuristic changes, most impactful first.
- Note any dead ends worth remembering for future runs.

### Reproduce

```bash
cd .autoloop/programs/<program>
python code/evaluate.py
```
```

## Guidelines

- Report `score` to at most 6 significant figures.
- If no improvement was found, say so plainly and explain the dead ends.
- Never claim an improvement that the evaluator did not confirm.
