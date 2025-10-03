# Evaluation Ontology: First Principles

## Core Entities

### 1. **Trace** (Execution Context)
The fundamental unit of observable behavior. A Trace represents a complete interaction flow.

```typescript
type Trace = {
  id: string                    // Unique identifier
  sessionID: string             // Which session this belongs to
  startTime: number
  endTime?: number
  status: "running" | "completed" | "failed"
  
  // Identity
  agentName: string             // Which agent executed this
  modelConfig: {                // Model configuration at time of execution
    provider: string
    model: string
    temperature?: number
    // ... other model params
  }
  
  // Prompt context
  systemPrompt: string          // The actual system prompt used
  systemPromptVersion?: string  // Semantic version or hash
  
  // Structure
  messages: Message[]           // The full conversation
  toolCalls: ToolCall[]         // All tool invocations
  
  // Outcomes
  tokens: TokenUsage
  cost: number
  
  // Evaluation
  evaluations?: Evaluation[]    // Assessments of this trace
}
```

**Why Trace?**
- A trace is self-contained - you can replay, analyze, or evaluate it independently
- It captures the entire context needed to understand "what happened"
- Maps naturally to OpenTelemetry/observability concepts
- Already partially exists via Session + Messages + TelemetryEvents

---

### 2. **Evaluation** (Assessment)
A judgment about a Trace or component thereof.

```typescript
type Evaluation = {
  id: string
  traceID: string
  
  // What's being evaluated
  target: {
    type: "trace" | "message" | "tool_call" | "output"
    id: string
  }
  
  // The evaluation criteria
  metricID: string              // Which metric was applied
  
  // The judgment
  score: number                 // Normalized 0-1 or metric-specific
  passed: boolean               // Did it meet threshold?
  
  // Context
  timestamp: number
  evaluatorType: "rule" | "llm" | "human" | "heuristic"
  evaluatorID?: string          // Which LLM or human
  
  // Evidence
  reasoning?: string            // Why this score (esp. for LLM judges)
  metadata?: Record<string, any>
}
```

**Why separate Evaluation from Trace?**
- A trace can be evaluated multiple times with different metrics
- Evaluations can be retroactive - evaluate past traces with new criteria
- Different stakeholders care about different evaluations
- Enables A/B testing of evaluation methods themselves

---

### 3. **Metric** (Evaluation Criterion)
Defines *what* we're measuring and *how*.

```typescript
type Metric = {
  id: string
  name: string
  description: string
  
  // What does this measure?
  domain: "correctness" | "safety" | "efficiency" | "quality" | "compliance"
  
  // How is it computed?
  evaluator: {
    type: "rule" | "llm" | "human" | "heuristic"
    
    // For rule-based
    rule?: {
      expression: string        // e.g., "duration < 5000"
      language: "javascript" | "jsonlogic"
    }
    
    // For LLM-based
    llm?: {
      prompt: string
      model: string
      parseOutput: "boolean" | "score_0_1" | "score_1_10" | "reasoning"
    }
    
    // For heuristic
    heuristic?: {
      function: string          // Name of built-in function
      params?: Record<string, any>
    }
  }
  
  // Interpretation
  threshold?: number            // Pass/fail cutoff
  higherIsBetter: boolean
  
  // Metadata
  version: string
  tags: string[]
}
```

**Built-in Heuristics Examples:**
- `tool_error_rate`: Ratio of failed tool calls
- `redundant_tool_calls`: Detects repeated identical calls
- `hallucination_indicators`: Flags suspicious patterns
- `token_efficiency`: Output quality per token spent

---

### 4. **Dataset** (Test Cases)
A collection of inputs with expected behaviors.

```typescript
type Dataset = {
  id: string
  name: string
  description: string
  version: string
  
  cases: TestCase[]
  
  // Metadata
  tags: string[]                // "regression", "edge_cases", "production_sample"
  createdAt: number
  updatedAt: number
}

type TestCase = {
  id: string
  
  // Input
  prompt: string                // What the user asks
  context?: {                   // Optional environmental context
    files?: string[]            // Which files exist
    workingDirectory?: string
  }
  
  // Expected behavior (can be partial)
  expected?: {
    toolCalls?: string[]        // Expected tools to be called
    output?: string             // Exact or fuzzy match
    assertions?: Assertion[]    // Custom checks
  }
  
  // Metadata
  tags: string[]
  difficulty?: "easy" | "medium" | "hard"
  source?: "synthetic" | "production" | "manual"
}

type Assertion = {
  type: "contains" | "not_contains" | "matches" | "tool_called" | "custom"
  value: any
  message?: string
}
```

**Why separate Dataset?**
- Enables versioning of test suites
- Can run same dataset across different agent configs
- Datasets can be shared/imported
- Natural basis for CI gates: "Run dataset X, all cases must pass metric Y"

---

### 5. **Experiment** (Comparative Run)
Structured comparison of different configurations.

```typescript
type Experiment = {
  id: string
  name: string
  description: string
  
  // What's being tested
  datasetID: string
  
  // Variants
  variants: Variant[]
  
  // Results
  runs: Run[]
  
  // Metadata
  status: "running" | "completed" | "failed"
  startTime: number
  endTime?: number
}

type Variant = {
  id: string
  name: string                  // "baseline", "new_prompt", "gpt4o"
  
  config: {
    agentName?: string
    systemPrompt?: string
    model?: string
    temperature?: number
    // ... any configurable parameter
  }
}

type Run = {
  variantID: string
  testCaseID: string
  traceID: string               // Links to the actual execution
  evaluations: Evaluation[]
}
```

**Why Experiment?**
- Formalizes A/B testing
- Enables statistical comparisons
- Natural fit for prompt optimization
- Can track what was learned: "new_prompt reduced error_rate by 15%"

---

### 6. **Scorecard** (Quality Contract)
A bundle of metrics that define "good enough".

```typescript
type Scorecard = {
  id: string
  name: string
  description: string
  
  // Which metrics matter?
  metrics: ScorecardMetric[]
  
  // How do we aggregate?
  passingCriteria: {
    requireAll: boolean         // AND vs OR
    minimumPassing?: number     // At least N metrics must pass
  }
  
  // Metadata
  version: string
  tags: string[]
}

type ScorecardMetric = {
  metricID: string
  weight: number                // For weighted scoring
  required: boolean             // Must pass vs nice-to-have
  threshold?: number            // Override metric default
}
```

**Why Scorecard?**
- Enables "shift left" - define quality gates early
- Different stages need different scorecards (dev vs staging vs prod)
- Can version scorecards as requirements evolve
- Natural CI integration: "This PR must pass scorecard:regression-prevention"

---

## Relationships

```
Dataset [1] ──< [N] TestCase
TestCase [1] ──< [N] Trace (via Experiment or direct execution)
Trace [1] ──< [N] ToolCall (via TelemetryEvent)
Trace [1] ──< [N] Evaluation
Evaluation [N] >── [1] Metric

Experiment [1] ──< [N] Variant
Experiment [1] ──> [1] Dataset
Experiment [1] ──< [N] Run
Run [1] ──> [1] Trace
Run [1] ──> [1] TestCase

Scorecard [1] ──< [N] ScorecardMetric
ScorecardMetric [N] >── [1] Metric
```

---

## Storage Design

### Current State (What Exists)
```typescript
// Storage paths
["session", projectID, sessionID] -> Session.Info
["message", sessionID, messageID] -> Message
["telemetry", "tools"] -> TelemetrySummary
```

### Proposed Additions
```typescript
// Traces (augmented sessions)
["trace", projectID, traceID] -> Trace
// Trace is basically Session + materialized tool events + evaluation results

// Evaluation data
["metric", metricID] -> Metric
["evaluation", traceID, evaluationID] -> Evaluation

// Test data
["dataset", datasetID] -> Dataset
["dataset", datasetID, "cases", caseID] -> TestCase

// Experiments
["experiment", experimentID] -> Experiment
["experiment", experimentID, "runs", runID] -> Run

// Scorecards
["scorecard", scorecardID] -> Scorecard

// Baselines (for comparison)
["baseline", name] -> {
  traceID: string
  timestamp: number
  metrics: Record<metricID, number>
}
```

---

## Integration with Existing System

### Already Have (Leverage)
1. **TelemetryEvent** → Maps to ToolCall in Trace
2. **Session + Messages** → Core of Trace
3. **ToolHistory** → Can evolve into TraceIndex
4. **Storage abstraction** → Can store new entities
5. **Bus system** → Can emit evaluation events

### Need to Build
1. **Trace materialization** - Convert Session → Trace (capture full context)
2. **Metric registry** - Define and load evaluation metrics
3. **Evaluator engine** - Execute metrics against traces
4. **Dataset management** - CRUD for test cases
5. **Experiment runner** - Orchestrate comparative runs
6. **Scorecard evaluator** - Check if trace meets quality bar

### Migration Path
**Phase 1: Trace Foundation**
- Extend Session with Trace concept
- Make system prompt, model config first-class
- Ensure all tool events link to traces

**Phase 2: Basic Evaluation**
- Implement Metric schema
- Build rule-based evaluator
- Add evaluations to traces

**Phase 3: Datasets & Experiments**
- Dataset storage + CRUD
- Simple experiment runner
- CLI: `opencode eval run dataset:smoke-tests`

**Phase 4: Advanced Features**
- LLM-as-judge metrics
- Scorecards + CI gates
- Synthetic data generation

---

## Key Design Principles

### 1. **Immutability**
- Traces are immutable once completed
- Evaluations are additive (never mutate a score)
- Enables time-travel debugging
- Can re-evaluate historical data

### 2. **Composability**
- Metrics compose into Scorecards
- Datasets are just collections of TestCases
- Experiments reference Datasets
- Everything has an ID, everything can reference

### 3. **Observability-Native**
- Every entity has timestamps
- Every operation emits events (via Bus)
- Natural fit for OpenTelemetry export
- Can stream evaluations in real-time

### 4. **Schema Evolution**
- Version everything (Metric v1.2.0, Dataset v3)
- Additive changes only (new fields, not breaking)
- Old data remains valid
- Can re-run with new metric versions

### 5. **Developer Ergonomics**
- Defaults for 90% case: `opencode eval` just works
- Progressive disclosure: simple → powerful
- Git-like model: local-first, can push/share
- Natural language where possible: "Test the auth flow"

---

## Example Workflows

### Workflow 1: Add a Regression Test
```bash
# Capture current behavior as a test case
opencode eval capture "Fix the login bug" --output dataset:auth-tests

# Later, ensure it doesn't regress
opencode eval run dataset:auth-tests --scorecard:regression
```

### Workflow 2: Optimize a Prompt
```bash
# Create experiment with 3 prompt variants
opencode eval experiment \
  --dataset=edge-cases \
  --baseline="current prompt" \
  --variant-1="revised prompt v1" \
  --variant-2="revised prompt v2" \
  --metrics=accuracy,latency,cost

# Shows comparison table, picks winner
```

### Workflow 3: CI Gate
```yaml
# .github/workflows/pr.yml
- name: Eval Gate
  run: |
    opencode eval run dataset:critical-paths \
      --scorecard:production-ready \
      --fail-on-regression
```

### Workflow 4: Production Monitoring
```bash
# Sample 1% of production traces
opencode eval sample --rate=0.01 --metrics=safety,hallucination

# Daily report
opencode eval report --since=24h --compare-to=baseline
```

---

## Open Questions

1. **Granularity of Traces**: Should we trace individual tool calls or just full sessions?
   - **Answer**: Sessions as traces, tool calls as spans within traces

2. **Evaluation Frequency**: Real-time, batch, or on-demand?
   - **Answer**: All three - streaming for CI, batch for experiments, on-demand for analysis

3. **LLM-as-Judge Costs**: How to make evaluations affordable at scale?
   - **Answer**: Sampling, caching, use cheaper models for routine checks

4. **Metric Versioning**: How to handle metric changes over time?
   - **Answer**: Semantic versioning, re-run with new versions is explicit

5. **Synthetic vs Real Data**: How to generate good test cases?
   - **Answer**: Start with production sampling, evolve to synthetic generators

6. **Baseline Drift**: How to keep baselines current as system improves?
   - **Answer**: Automatic baseline updates when new records set, manual approval

---

## Success Metrics for This System

1. **Time to detect regression**: < 10 minutes (in CI)
2. **False positive rate**: < 5% (don't block good changes)
3. **Coverage**: 80%+ of tool operations have telemetry
4. **Adoption**: Team actually uses it (ergonomics matter)
5. **Insight generation**: Surfaces actionable patterns weekly

---

## Conclusion

The ontology builds on three core ideas:

1. **Trace as the atomic unit** - Everything flows from captured executions
2. **Evaluation as a separate concern** - Decoupled from generation, versionable, composable
3. **Developer-centric design** - Built for the team using OpenCode daily, not abstract metrics

This maps naturally to EvalOps' mission: ship LLM changes confidently by making quality observable, measurable, and gateable.
