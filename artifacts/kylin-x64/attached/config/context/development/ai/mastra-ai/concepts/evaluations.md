<!-- Context: development/evaluations | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Concept: Mastra Evaluations

**Purpose**: Quality assurance and scoring for LLM outputs.

**Last Updated**: 2026-01-09

---

## Core Idea
Evaluations in Mastra use Scorers to assess the quality, accuracy, and safety of LLM-generated content. They provide a quantitative way to measure performance and detect issues like hallucinations or factual errors.

## Key Points
- **Scorers**: Specialized functions that take LLM output (and optionally ground truth) and return a score (0-1).
- **Integration**: Registered in the Mastra instance and can be triggered automatically during workflow execution.
- **Metrics**: Common metrics include hallucination detection, fact validation, and relevance scoring.
- **Audit Trail**: Scorer results are stored in the `mastra_scorers` table for long-term analysis and reporting.

## Quick Example
```typescript
// Scorer definition
export const hallucinationDetector = new Scorer({
  id: 'hallucination-detector',
  description: 'Detects hallucinations in LLM output',
  execute: async ({ output, context }) => {
    // Logic to detect hallucinations
    return { score: 0.95, rationale: 'No hallucinations found' };
  },
});

// Registration
export const mastra = new Mastra({
  scorers: { hallucinationDetector },
});
```

**Reference**: `src/mastra/scorers/`, `src/mastra/evaluation/`
**Related**:
- concepts/core.md
- concepts/workflows.md
