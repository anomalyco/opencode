# `ce-optimize`

Run iterative optimization loops for problems where you can try multiple variants and score them with the same measurement setup.

## When To Use It

Use `/ce-optimize` when:

- The right change is not obvious up front
- You can generate several plausible variants
- You have a repeatable measurement harness
- "Better" can be expressed as a hard metric or an LLM-as-judge evaluation

Good fits:

- Tuning memory, timeout, concurrency, or batch-size settings where you can measure crashes, latency, throughput, or error rate
- Improving clustering, ranking, search, or recommendation quality where hard metrics alone can be gamed
- Optimizing prompts where both output quality and token cost matter

Usually not a good fit:

- One-shot bug fixes with an obvious root cause
- Changes without a repeatable measurement harness
- Problems where "better" cannot be measured or judged consistently

## Quick Start

- Start with [`references/example-hard-spec.yaml`](./references/example-hard-spec.yaml) for objective targets
- Start with [`references/example-judge-spec.yaml`](./references/example-judge-spec.yaml) when semantics matter and you need LLM-as-judge
- Keep the first run serial, small, and cheap until the harness is trustworthy
- Avoid introducing new dependencies until the baseline and evaluation loop are stable

## Docs

- [`SKILL.md`](./SKILL.md): full orchestration workflow and runtime rules
- [`references/usage-guide.md`](./references/usage-guide.md): example prompts and practical "when/how to use this skill" guidance
- [`references/optimize-spec-schema.yaml`](./references/optimize-spec-schema.yaml): optimization spec schema
- [`references/experiment-log-schema.yaml`](./references/experiment-log-schema.yaml): experiment log schema
