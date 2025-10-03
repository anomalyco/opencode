# Evaluation Implementation Strategy

## Phase 1: Foundation (Week 1-2)

### 1.1 Trace Materialization

**Goal**: Unify Session + TelemetryEvents into a complete Trace abstraction

**Changes**:
```typescript
// packages/opencode/src/trace/index.ts
export namespace Trace {
  // Extends Session with evaluation context
  export type Complete = {
    // Session data
    session: Session.Info
    messages: MessageV2.Message[]
    
    // Execution context (NEW)
    agentName: string
    modelConfig: {
      provider: string
      model: string
      temperature?: number
      maxTokens?: number
    }
    systemPrompt: string
    systemPromptVersion?: string
    
    // Tool events (already captured)
    toolCalls: TelemetryEvent[]
    
    // Aggregated metrics
    summary: {
      duration: number
      toolCallCount: number
      errorCount: number
      tokens: TokenUsage
      cost: number
    }
    
    // Evaluation results (empty initially)
    evaluations: Evaluation[]
  }
  
  // Create a trace from a session
  export async function materialize(sessionID: string): Promise<Complete>
  
  // List traces with filters
  export async function list(filter?: TraceFilter): AsyncIterableIterator<Complete>
  
  // Get a specific trace
  export async function get(traceID: string): Promise<Complete>
}
```

**Implementation**:
```typescript
export async function materialize(sessionID: string): Promise<Trace.Complete> {
  const session = await Session.get(sessionID)
  const messages = await Session.messages(sessionID)
  
  // Get telemetry events for this session
  const history = await ToolHistory.read()
  const toolCalls = history.events.filter(e => e.sessionID === sessionID)
  
  // Extract model config from first assistant message
  const firstAssistant = messages.find(m => m.info.role === "assistant")
  const modelConfig = firstAssistant ? {
    provider: firstAssistant.info.providerID,
    model: firstAssistant.info.modelID,
    // Extract other params from metadata
  } : { provider: "unknown", model: "unknown" }
  
  // Load system prompt (from session init)
  const systemPrompt = await getSystemPromptForSession(sessionID)
  
  return {
    session,
    messages,
    agentName: session.agent ?? "default",
    modelConfig,
    systemPrompt,
    toolCalls,
    summary: computeSummary(messages, toolCalls),
    evaluations: []
  }
}
```

**Storage**: Store materialized traces
```typescript
["trace", projectID, sessionID] -> Trace.Complete
```

**Event**: Emit trace completion
```typescript
Bus.publish(Trace.Event.Completed, { trace })
```

---

### 1.2 Metric Registry

**Goal**: Define evaluation metrics as declarative config

**Schema**:
```typescript
// packages/opencode/src/evaluation/metric.ts
export namespace Metric {
  export type Definition = {
    id: string
    name: string
    description: string
    version: string
    
    category: "performance" | "correctness" | "safety" | "cost"
    
    evaluator: RuleEvaluator | LLMEvaluator | HeuristicEvaluator
    
    threshold?: {
      pass: number
      warn?: number
    }
    
    higherIsBetter: boolean
  }
  
  type RuleEvaluator = {
    type: "rule"
    expression: string  // JavaScript expression
  }
  
  type LLMEvaluator = {
    type: "llm"
    prompt: string
    model: string
    parseScore: (output: string) => number
  }
  
  type HeuristicEvaluator = {
    type: "heuristic"
    function: keyof typeof Heuristics
    params?: Record<string, any>
  }
}
```

**Built-in Metrics** (start with simple ones):
```typescript
// packages/opencode/src/evaluation/metrics/builtin.ts
export const BuiltinMetrics: Record<string, Metric.Definition> = {
  "tool-error-rate": {
    id: "tool-error-rate",
    name: "Tool Error Rate",
    description: "Percentage of tool calls that failed",
    version: "1.0.0",
    category: "performance",
    evaluator: {
      type: "heuristic",
      function: "toolErrorRate"
    },
    threshold: {
      pass: 0.1,  // <10% errors
      warn: 0.05
    },
    higherIsBetter: false
  },
  
  "response-latency": {
    id: "response-latency", 
    name: "Response Latency",
    description: "Total time to complete request",
    version: "1.0.0",
    category: "performance",
    evaluator: {
      type: "rule",
      expression: "trace.summary.duration"
    },
    threshold: {
      pass: 30000,  // <30s
      warn: 10000   // <10s is good
    },
    higherIsBetter: false
  },
  
  "redundant-calls": {
    id: "redundant-calls",
    name: "Redundant Tool Calls",
    description: "Detects repeated identical tool calls",
    version: "1.0.0",
    category: "correctness",
    evaluator: {
      type: "heuristic",
      function: "detectRedundantCalls"
    },
    threshold: { pass: 0 },
    higherIsBetter: false
  }
}
```

**Heuristic Implementations**:
```typescript
// packages/opencode/src/evaluation/heuristics.ts
export const Heuristics = {
  toolErrorRate(trace: Trace.Complete): number {
    if (trace.toolCalls.length === 0) return 0
    const errors = trace.toolCalls.filter(t => t.status === "error").length
    return errors / trace.toolCalls.length
  },
  
  detectRedundantCalls(trace: Trace.Complete): number {
    const seen = new Map<string, number>()
    for (const call of trace.toolCalls) {
      const key = `${call.id}:${JSON.stringify(call.extra)}`
      seen.set(key, (seen.get(key) || 0) + 1)
    }
    return Array.from(seen.values()).filter(count => count > 1).length
  },
  
  // More heuristics...
}
```

---

### 1.3 Evaluation Engine

**Goal**: Execute metrics against traces and store results

```typescript
// packages/opencode/src/evaluation/engine.ts
export namespace EvaluationEngine {
  export type Result = {
    id: string
    traceID: string
    metricID: string
    score: number
    passed: boolean
    timestamp: number
    
    evaluatorType: "rule" | "llm" | "heuristic"
    reasoning?: string
    metadata?: Record<string, any>
  }
  
  // Evaluate a trace against a metric
  export async function evaluate(
    trace: Trace.Complete,
    metric: Metric.Definition
  ): Promise<Result> {
    const score = await computeScore(trace, metric)
    const threshold = metric.threshold?.pass ?? 0
    
    const passed = metric.higherIsBetter 
      ? score >= threshold 
      : score <= threshold
    
    return {
      id: Identifier.ascending("evaluation"),
      traceID: trace.session.id,
      metricID: metric.id,
      score,
      passed,
      timestamp: Date.now(),
      evaluatorType: metric.evaluator.type
    }
  }
  
  // Evaluate against multiple metrics
  export async function evaluateMany(
    trace: Trace.Complete,
    metrics: Metric.Definition[]
  ): Promise<Result[]> {
    return Promise.all(metrics.map(m => evaluate(trace, m)))
  }
  
  async function computeScore(
    trace: Trace.Complete, 
    metric: Metric.Definition
  ): Promise<number> {
    switch (metric.evaluator.type) {
      case "rule":
        return evaluateRule(trace, metric.evaluator.expression)
      case "heuristic":
        return evaluateHeuristic(trace, metric.evaluator)
      case "llm":
        return evaluateLLM(trace, metric.evaluator)
    }
  }
  
  function evaluateRule(trace: Trace.Complete, expression: string): number {
    // Safe eval with restricted context
    const func = new Function("trace", `return ${expression}`)
    return func(trace)
  }
  
  function evaluateHeuristic(
    trace: Trace.Complete, 
    evaluator: Extract<Metric.Definition["evaluator"], { type: "heuristic" }>
  ): number {
    const heuristic = Heuristics[evaluator.function]
    if (!heuristic) throw new Error(`Unknown heuristic: ${evaluator.function}`)
    return heuristic(trace, evaluator.params)
  }
  
  async function evaluateLLM(
    trace: Trace.Complete,
    evaluator: Extract<Metric.Definition["evaluator"], { type: "llm" }>
  ): Promise<number> {
    // Call LLM with prompt + trace context
    const response = await callLLM(evaluator.model, {
      prompt: evaluator.prompt,
      context: formatTraceForLLM(trace)
    })
    return evaluator.parseScore(response)
  }
}
```

**Storage**:
```typescript
["evaluation", traceID, evaluationID] -> EvaluationEngine.Result
```

---

## Phase 2: Datasets & Testing (Week 3-4)

### 2.1 Dataset Management

```typescript
// packages/opencode/src/evaluation/dataset.ts
export namespace Dataset {
  export type Definition = {
    id: string
    name: string
    description: string
    version: string
    
    cases: TestCase[]
    
    tags: string[]
    createdAt: number
    updatedAt: number
  }
  
  export type TestCase = {
    id: string
    name: string
    
    // Input
    prompt: string
    context?: {
      files?: Array<{ path: string; content: string }>
      workingDirectory?: string
      env?: Record<string, string>
    }
    
    // Expectations (optional, for assertions)
    expected?: {
      toolCalls?: string[]        // Expected tool IDs
      outputContains?: string[]   // Substrings that should appear
      outputNotContains?: string[]
      assertions?: Assertion[]
    }
    
    tags: string[]
    metadata?: Record<string, any>
  }
  
  export type Assertion = {
    type: "tool-called" | "tool-not-called" | "output-matches" | "custom"
    params: Record<string, any>
    message: string
  }
  
  // CRUD operations
  export async function create(def: Omit<Definition, "id" | "createdAt" | "updatedAt">): Promise<Definition>
  export async function get(id: string): Promise<Definition>
  export async function update(id: string, changes: Partial<Definition>): Promise<Definition>
  export async function list(): AsyncIterableIterator<Definition>
  export async function delete(id: string): Promise<void>
  
  // Case management
  export async function addCase(datasetID: string, testCase: Omit<TestCase, "id">): Promise<TestCase>
  export async function removeCase(datasetID: string, caseID: string): Promise<void>
}
```

**Storage**:
```typescript
["dataset", datasetID] -> Dataset.Definition
```

**CLI**:
```bash
# Create dataset from scratch
opencode dataset create smoke-tests --description "Critical path tests"

# Add test case
opencode dataset add smoke-tests --prompt "Create a file called test.txt with 'hello world'"

# Capture current interaction as test case
opencode dataset capture --name "auth flow" --dataset auth-tests

# List datasets
opencode dataset list

# Export/Import
opencode dataset export smoke-tests > smoke-tests.json
opencode dataset import < smoke-tests.json
```

---

### 2.2 Test Runner

```typescript
// packages/opencode/src/evaluation/runner.ts
export namespace TestRunner {
  export type RunConfig = {
    datasetID: string
    metrics: string[]         // Metric IDs to evaluate
    
    // Agent config (what to test)
    agentName?: string
    modelOverride?: string
    systemPromptOverride?: string
    
    // Execution options
    parallel?: number         // How many tests to run in parallel
    timeout?: number
    stopOnFailure?: boolean
  }
  
  export type RunResult = {
    id: string
    datasetID: string
    config: RunConfig
    
    startTime: number
    endTime: number
    
    results: CaseResult[]
    
    summary: {
      total: number
      passed: number
      failed: number
      duration: number
    }
  }
  
  export type CaseResult = {
    caseID: string
    traceID: string
    
    status: "passed" | "failed" | "error"
    
    evaluations: EvaluationEngine.Result[]
    assertionResults: AssertionResult[]
    
    duration: number
    error?: string
  }
  
  export async function run(config: RunConfig): Promise<RunResult> {
    const dataset = await Dataset.get(config.datasetID)
    const metrics = await Promise.all(
      config.metrics.map(id => MetricRegistry.get(id))
    )
    
    const results: CaseResult[] = []
    
    for (const testCase of dataset.cases) {
      // Execute the test case
      const trace = await executeTestCase(testCase, config)
      
      // Evaluate
      const evaluations = await EvaluationEngine.evaluateMany(trace, metrics)
      
      // Check assertions
      const assertionResults = testCase.expected?.assertions
        ? await checkAssertions(trace, testCase.expected.assertions)
        : []
      
      const allPassed = 
        evaluations.every(e => e.passed) &&
        assertionResults.every(a => a.passed)
      
      results.push({
        caseID: testCase.id,
        traceID: trace.session.id,
        status: allPassed ? "passed" : "failed",
        evaluations,
        assertionResults,
        duration: trace.summary.duration
      })
      
      if (!allPassed && config.stopOnFailure) break
    }
    
    return {
      id: Identifier.ascending("test-run"),
      datasetID: config.datasetID,
      config,
      startTime: Date.now(),
      endTime: Date.now(),
      results,
      summary: computeSummary(results)
    }
  }
  
  async function executeTestCase(
    testCase: Dataset.TestCase,
    config: RunConfig
  ): Promise<Trace.Complete> {
    // Create a test session
    const session = await Session.create()
    
    // Apply context overrides
    if (testCase.context?.files) {
      // Mock file system
    }
    
    // Send the prompt
    await SessionPrompt.prompt({
      sessionID: session.id,
      parts: [{ type: "text", text: testCase.prompt }],
      agent: config.agentName,
      model: config.modelOverride
    })
    
    // Wait for completion
    await waitForSessionComplete(session.id, config.timeout)
    
    // Materialize trace
    return Trace.materialize(session.id)
  }
}
```

**CLI**:
```bash
# Run a dataset with default metrics
opencode test run smoke-tests

# Run with specific metrics
opencode test run smoke-tests --metrics tool-error-rate,response-latency

# Run and fail CI if any test fails
opencode test run regression-suite --fail-on-error --quiet

# Run with prompt override
opencode test run edge-cases --system-prompt "You are extra cautious"

# Compare two configurations
opencode test compare smoke-tests \
  --baseline "model=gpt-4" \
  --variant "model=claude-3.5-sonnet"
```

---

## Phase 3: CI Integration (Week 5)

### 3.1 Scorecards

```typescript
// packages/opencode/src/evaluation/scorecard.ts
export namespace Scorecard {
  export type Definition = {
    id: string
    name: string
    description: string
    version: string
    
    metrics: ScorecardMetric[]
    
    passingCriteria: {
      requireAll: boolean
      minimumPassing?: number
    }
    
    tags: string[]
  }
  
  export type ScorecardMetric = {
    metricID: string
    weight: number
    required: boolean
    thresholdOverride?: number
  }
  
  export async function evaluate(
    scorecard: Definition,
    trace: Trace.Complete
  ): Promise<ScorecardResult> {
    const metrics = await Promise.all(
      scorecard.metrics.map(sm => MetricRegistry.get(sm.metricID))
    )
    
    const evaluations = await EvaluationEngine.evaluateMany(trace, metrics)
    
    const results = scorecard.metrics.map((sm, i) => {
      const evaluation = evaluations[i]
      const threshold = sm.thresholdOverride ?? metrics[i].threshold?.pass
      
      return {
        metricID: sm.metricID,
        score: evaluation.score,
        passed: evaluation.passed,
        required: sm.required,
        weight: sm.weight
      }
    })
    
    const requiredPassed = results
      .filter(r => r.required)
      .every(r => r.passed)
    
    const totalPassed = results.filter(r => r.passed).length
    const meetsMinimum = !scorecard.passingCriteria.minimumPassing ||
      totalPassed >= scorecard.passingCriteria.minimumPassing
    
    const overallPass = scorecard.passingCriteria.requireAll
      ? results.every(r => r.passed)
      : requiredPassed && meetsMinimum
    
    return {
      scorecardID: scorecard.id,
      traceID: trace.session.id,
      results,
      overallPass,
      timestamp: Date.now()
    }
  }
}
```

**Predefined Scorecards**:
```typescript
// packages/opencode/src/evaluation/scorecards/builtin.ts
export const BuiltinScorecards: Record<string, Scorecard.Definition> = {
  "regression-prevention": {
    id: "regression-prevention",
    name: "Regression Prevention",
    description: "Ensures code changes don't break existing behavior",
    version: "1.0.0",
    metrics: [
      { metricID: "tool-error-rate", weight: 1, required: true },
      { metricID: "response-latency", weight: 0.5, required: false },
      { metricID: "redundant-calls", weight: 0.5, required: false }
    ],
    passingCriteria: {
      requireAll: false,
      minimumPassing: 2
    },
    tags: ["ci", "critical"]
  },
  
  "production-ready": {
    id: "production-ready",
    name: "Production Ready",
    description: "Meets production quality standards",
    version: "1.0.0",
    metrics: [
      { metricID: "tool-error-rate", weight: 1, required: true },
      { metricID: "response-latency", weight: 1, required: true },
      { metricID: "redundant-calls", weight: 1, required: true },
      { metricID: "cost-efficiency", weight: 0.5, required: false }
    ],
    passingCriteria: {
      requireAll: true
    },
    tags: ["production", "strict"]
  }
}
```

---

### 3.2 GitHub Action Integration

```yaml
# .github/workflows/eval.yml
name: Evaluation Gates

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  eval-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup OpenCode
        run: |
          curl -fsSL https://opencode.ai/install | bash
          opencode auth login --token ${{ secrets.OPENCODE_TOKEN }}
      
      - name: Run Regression Tests
        run: |
          opencode test run regression-suite \
            --scorecard regression-prevention \
            --fail-on-error \
            --output json > eval-results.json
      
      - name: Post Results to PR
        if: always()
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs')
            const results = JSON.parse(fs.readFileSync('eval-results.json'))
            
            const comment = `## Evaluation Results
            
            ${results.summary.passed}/${results.summary.total} tests passed
            
            ${results.summary.passed < results.summary.total ? '❌ Some tests failed' : '✅ All tests passed'}
            `
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            })
      
      - name: Upload Detailed Results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: eval-results
          path: eval-results.json
```

---

## Phase 4: Advanced Features (Week 6+)

### 4.1 LLM-as-Judge Metrics

```typescript
// Example: Hallucination detection
const hallucinationMetric: Metric.Definition = {
  id: "hallucination-detection",
  name: "Hallucination Detection",
  description: "Detects when the agent makes unsupported claims",
  version: "1.0.0",
  category: "correctness",
  evaluator: {
    type: "llm",
    model: "gpt-4o-mini",  // Cheaper model for evals
    prompt: `You are evaluating an AI coding assistant's response for hallucinations.

Context: The assistant had access to these files:
{{available_files}}

The assistant's response:
{{response}}

Tool calls made:
{{tool_calls}}

Question: Did the assistant make any claims about files, functions, or code that it couldn't have known from the available context?

Respond with a score from 0-1:
- 0 = No hallucinations, all claims are grounded
- 0.5 = Minor unsupported assumptions
- 1 = Major hallucinations or fabricated information

Score:`,
    parseScore: (output: string) => {
      const match = output.match(/Score:\s*([\d.]+)/)
      return match ? parseFloat(match[1]) : 0.5
    }
  },
  threshold: { pass: 0.3 },
  higherIsBetter: false
}
```

---

### 4.2 Synthetic Data Generation

```typescript
// packages/opencode/src/evaluation/synthetic.ts
export namespace SyntheticData {
  export type GeneratorConfig = {
    baseScenarios: string[]      // e.g., "create a file", "debug an error"
    variations: number            // How many variations per scenario
    complexity: "simple" | "medium" | "complex"
  }
  
  export async function generate(config: GeneratorConfig): Promise<Dataset.TestCase[]> {
    const cases: Dataset.TestCase[] = []
    
    for (const scenario of config.baseScenarios) {
      // Use LLM to generate variations
      const prompt = `Generate ${config.variations} variations of this coding task: "${scenario}"
      
      Complexity level: ${config.complexity}
      
      For each variation, provide:
      1. A clear task description
      2. Expected tool usage
      3. Success criteria
      
      Format as JSON array.`
      
      const variations = await callLLM("gpt-4", { prompt })
      
      for (const variation of variations) {
        cases.push({
          id: Identifier.ascending("test-case"),
          name: variation.description,
          prompt: variation.description,
          expected: {
            toolCalls: variation.expectedTools,
            assertions: variation.assertions
          },
          tags: ["synthetic", config.complexity],
          metadata: { generatedFrom: scenario }
        })
      }
    }
    
    return cases
  }
}
```

**CLI**:
```bash
# Generate test cases
opencode dataset generate \
  --scenarios "file operations,refactoring,debugging" \
  --variations 5 \
  --complexity medium \
  --output edge-cases
```

---

## Summary: What Gets Built When

**Week 1-2: Foundation**
- ✅ Trace materialization
- ✅ Metric registry with 5-10 built-in metrics
- ✅ Evaluation engine (rule + heuristic)
- ✅ Storage layer
- 🔧 CLI: `opencode eval trace <session-id>`

**Week 3-4: Datasets**
- ✅ Dataset CRUD
- ✅ Test runner
- ✅ Assertion framework
- 🔧 CLI: `opencode test run <dataset>`

**Week 5: CI Integration**
- ✅ Scorecards
- ✅ GitHub Action
- ✅ PR comments with results
- 🔧 CLI: `opencode test run --fail-on-error`

**Week 6+: Advanced**
- ⏳ LLM-as-judge metrics
- ⏳ Synthetic data generation
- ⏳ Experiment framework (A/B testing)
- ⏳ Web dashboard for results

---

## Development Philosophy

1. **Start with telemetry** - Already have tool instrumentation, build on it
2. **Dogfood immediately** - Use it to test Grimoire itself
3. **Ship incrementally** - Each phase is independently useful
4. **Learn from usage** - Let real usage guide metric selection
5. **Keep it fast** - Sub-10min CI runs, real-time feedback
