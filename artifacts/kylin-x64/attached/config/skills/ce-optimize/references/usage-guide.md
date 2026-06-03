# `/ce-optimize` Usage Guide

## What This Skill Is For

`/ce-optimize` is for hard engineering problems where:

1. You can try multiple code or config variants.
2. You can run the same evaluation against each variant.
3. You want the skill to keep the good variants and reject the bad ones.

It is best for "search the space and score the results" work, not one-shot implementation work.

## When To Use It

Use `/ce-optimize` when the problem looks like:

- "Find the smallest memory limit that stops OOM crashes without wasting RAM."
- "Tune clustering parameters without collapsing everything into one garbage cluster."
- "Find a prompt that is cheaper but still produces summaries good enough for downstream clustering."
- "Compare several ranking, retrieval, batching, or threshold strategies against the same harness."

Choose `type: hard` when success is objective and cheap to measure:

- Memory usage
- Latency
- Throughput
- Test pass rate
- Build time

Choose `type: judge` when a numeric metric can be gamed or when human usefulness matters:

- Cluster coherence
- Search relevance
- Summary quality
- Prompt quality
- Classification quality with semantic edge cases

## When Not To Use It

`/ce-optimize` is usually the wrong tool when:

- The fix is obvious and does not need experimentation
- There is no repeatable measurement harness
- The search space is fake and only has one plausible answer
- The cost of evaluating variants is too high to justify multiple runs

## How To Think About It

The pattern is:

1. Define the target.
2. Build or validate the measurement harness first.
3. Generate multiple plausible variants.
4. Run the same evaluation loop against each variant.
5. Keep the variants that improve the target without violating guard rails.

The core rule is simple:

- If a hard metric captures "better," optimize the hard metric.
- If a hard metric can be gamed, add LLM-as-judge.

Example: lowering a clustering threshold may increase cluster coverage. That sounds good until everything ends up in one giant cluster. Hard metrics may say "improved"; an LLM judge sampling real clusters can say "this is trash."

## First-Run Advice

For the first run:

- Prefer `execution.mode: serial`
- Set `execution.max_concurrent: 1`
- Keep `stopping.max_iterations` small
- Keep `stopping.max_hours` small
- Avoid new dependencies until the baseline is trustworthy
- In judge mode, use a small sample and a low cost cap

The goal of the first run is to validate the harness, not to win the optimization immediately.

## Example Prompts

### 1. Memory Tuning

```text
Use /ce-optimize to find the smallest memory setting that keeps this service stable under our load test.

The current container limit is 512 MB and the app sometimes OOM-crashes. Do not just jump to 8 GB. Try a small set of realistic memory limits, run the same load test for each one, and score the results using:
- did the process OOM
- did tail latency spike badly
- did GC pauses become excessive

Prefer the smallest memory limit that passes the guard rails.
```

### 2. Clustering Quality

```text
Use /ce-optimize to improve issue and PR clustering quality.

We have about 18k open issues and PRs. We want to test changes that improve clustering quality, reduce singleton clusters, and improve match quality within each cluster.

Do not mutate the shared default database. Copy it for the run, then use per-experiment copies when needed.

Do not optimize only for coverage. Use LLM-as-judge to sample clusters and confirm they still preserve real semantic similarity instead of collapsing into giant low-quality clusters.
```

### 3. Prompt Optimization

```text
Use /ce-optimize to create a summarization prompt for issues and PRs that minimizes token spend while still producing summaries that are good enough for downstream clustering.

I want the loop to compare prompt variants, measure token cost, and judge whether the summaries preserve the distinctions needed to cluster related issues together without merging unrelated ones.
```

## Choosing Between Hard Metrics And Judge Mode

Use hard metrics alone when:

- "Better" is obvious from the numbers.

Add judge mode when:

- The numbers can improve while the real output gets worse.

Common pattern:

- Hard gates reject broken outputs.
- Judge mode scores the surviving candidates for actual usefulness.

That hybrid setup is often the best default for ranking, clustering, and prompt work.
