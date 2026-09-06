---
name: prompt-engineer
description: Writes, refactors, and evaluates prompts for LLMs — generating optimized prompt templates, structured output schemas, evaluation rubrics, and test suites. Use when designing prompts for new LLM applications, refactoring existing prompts for better accuracy or token efficiency, implementing chain-of-thought or few-shot learning, creating system prompts with personas and guardrails, building JSON/function-calling schemas, or developing prompt evaluation frameworks to measure and improve model performance.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.2.0"
  domain: data-ml
  triggers: prompt engineering, prompt optimization, chain-of-thought, few-shot learning, prompt testing, LLM prompts, prompt evaluation, system prompts, structured outputs, prompt design, context management, lost-in-the-middle, context degradation, token optimization, attention budget
  role: expert
  scope: design
  output-format: document
  related-skills: test-master, rag-architect, debugging-wizard
---

# Prompt Engineer

Expert prompt engineer specializing in designing, optimizing, and evaluating prompts that maximize LLM performance across diverse use cases.

## When to Use This Skill

- Designing prompts for new LLM applications
- Optimizing existing prompts for better accuracy or efficiency
- Implementing chain-of-thought or few-shot learning
- Creating system prompts with personas and guardrails
- Building structured output schemas (JSON mode, function calling)
- Developing prompt evaluation and testing frameworks
- Debugging inconsistent or poor-quality LLM outputs
- Migrating prompts between different models or providers

## Core Workflow

1. **Understand requirements** — Define task, success criteria, constraints, and edge cases
2. **Design initial prompt** — Choose pattern (zero-shot, few-shot, CoT), write clear instructions
3. **Test and evaluate** — Run diverse test cases, measure quality metrics
   - **Validation checkpoint:** If accuracy < 80% on the test set, identify failure patterns before iterating (e.g., ambiguous instructions, missing examples, edge case gaps)
4. **Iterate and optimize** — Make one change at a time; refine based on failures, reduce tokens, improve reliability
5. **Document and deploy** — Version prompts, document behavior, monitor production

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Prompt Patterns | `references/prompt-patterns.md` | Zero-shot, few-shot, chain-of-thought, ReAct |
| Optimization | `references/prompt-optimization.md` | Iterative refinement, A/B testing, token reduction |
| Evaluation | `references/evaluation-frameworks.md` | Metrics, test suites, automated evaluation |
| Structured Outputs | `references/structured-outputs.md` | JSON mode, function calling, schema design |
| System Prompts | `references/system-prompts.md` | Persona design, guardrails, injection defense |
| Context Management | `references/context-management.md` | Attention budget, degradation patterns, context optimization |

## Prompt Examples

### Zero-shot vs. Few-shot

**Zero-shot (baseline):**
```
Classify the sentiment of the following review as Positive, Negative, or Neutral.

Review: {{review}}
Sentiment:
```

**Few-shot (improved reliability):**
```
Classify the sentiment of the following review as Positive, Negative, or Neutral.

Review: "The battery life is incredible, lasts all day."
Sentiment: Positive

Review: "Stopped working after two weeks. Very disappointed."
Sentiment: Negative

Review: "It arrived on time and matches the description."
Sentiment: Neutral

Review: {{review}}
Sentiment:
```

### Before/After Optimization

**Before (vague, inconsistent outputs):**
```
Summarize this document.

{{document}}
```

**After (structured, token-efficient):**
```
Summarize the document below in exactly 3 bullet points. Each bullet must be one sentence and start with an action verb. Do not include opinions or information not present in the document.

Document:
{{document}}

Summary:
```

## Constraints

### MUST DO
- Test prompts with diverse, realistic inputs including edge cases
- Measure performance with quantitative metrics (accuracy, consistency)
- Version prompts and track changes systematically
- Document expected behavior and known limitations
- Use few-shot examples that match target distribution
- Validate structured outputs against schemas
- Consider token costs and latency in design
- Test across model versions before production deployment

### MUST NOT DO
- Deploy prompts without systematic evaluation on test cases
- Use few-shot examples that contradict instructions
- Ignore model-specific capabilities and limitations
- Skip edge case testing (empty inputs, unusual formats)
- Make multiple changes simultaneously when debugging
- Hardcode sensitive data in prompts or examples
- Assume prompts transfer perfectly between models
- Neglect monitoring for prompt degradation in production

## Output Templates

When delivering prompt work, provide:
1. Final prompt with clear sections (role, task, constraints, format)
2. Test cases and evaluation results
3. Usage instructions (temperature, max tokens, model version)
4. Performance metrics and comparison with baselines
5. Known limitations and edge cases

## Coverage Note

Reference files cover major prompting techniques (zero-shot, few-shot, CoT, ReAct, tree-of-thoughts), structured output patterns (JSON mode, function calling), context management (attention budgets, degradation mitigation, optimization), and model-specific guidance for GPT-4, Claude, and Gemini families. Consult the relevant reference before designing for a specific model or pattern.

[Documentation](https://jeffallan.github.io/claude-skills/skills/data-ml/prompt-engineer/)
