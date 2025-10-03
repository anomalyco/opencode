# Evaluation Framework Implementation Status

## Completed ✅

### Stream 1: Trace Foundation
**Commit**: `0e92e2f8` - "trace: implement trace foundation"

- ✅ Created `Trace` namespace with complete type definitions
- ✅ Implemented `Trace.materialize()` to convert sessions to traces
- ✅ Added trace storage layer (`get`, `list`, `exists`, `remove`)
- ✅ Implemented filtering for trace queries
- ✅ Added `trace.completed` event emission
- ✅ Computed summary statistics (duration, tokens, cost, errors)

**Files Created**:
- `packages/opencode/src/trace/index.ts` (247 lines)

**Key Capabilities**:
```typescript
// Materialize any session into a trace
const trace = await Trace.materialize(sessionID)

// Query traces with filters
for await (const trace of Trace.list({ hasErrors: true, minDuration: 5000 })) {
  console.log(trace.summary)
}

// Get specific trace
const trace = await Trace.get(traceID)
```

---

## Next Steps (Ready to Implement)

### Stream 2: Metric Registry (2-3 hours)
**Goal**: Define evaluation criteria

**Steps**:
1. Create metric schema (`packages/opencode/src/evaluation/metric.ts`)
2. Implement metric registry (CRUD operations)
3. Build 5-7 built-in metrics:
   - `tool-error-rate`: % of failed tool calls
   - `response-latency`: Total duration
   - `redundant-calls`: Detect repeated calls
   - `cost-efficiency`: Cost per successful operation
   - `token-efficiency`: Output tokens / total tokens
4. Create rule-based evaluator (JavaScript expressions)
5. Add metric storage layer
6. Implement metric versioning

**Files to Create**:
- `packages/opencode/src/evaluation/metric.ts`
- `packages/opencode/src/evaluation/heuristics.ts`
- `packages/opencode/src/evaluation/metrics/builtin.ts`

---

### Stream 3: Evaluation Engine (3-4 hours)
**Depends on**: Streams 1 & 2

**Steps**:
1. Create evaluation result schema
2. Implement heuristic evaluator
3. Implement rule evaluator  
4. Build evaluation engine orchestrator
5. Add evaluation storage
6. Create evaluation query API
7. Emit evaluation events

**Files to Create**:
- `packages/opencode/src/evaluation/engine.ts`
- `packages/opencode/src/evaluation/index.ts`

---

### Stream 4: Dataset Management (2-3 hours)
**Can run in parallel with Stream 3**

**Steps**:
1. Create dataset schema
2. Implement dataset CRUD
3. Create test case schema with assertions
4. Build dataset storage layer
5. Add dataset CLI commands
6. Create dataset import/export

**Files to Create**:
- `packages/opencode/src/evaluation/dataset.ts`
- `packages/opencode/src/cli/cmd/dataset.ts`

---

### Stream 5: Test Runner (3-4 hours)
**Depends on**: Streams 3 & 4

**Steps**:
1. Create test execution engine
2. Implement assertion framework
3. Build test result aggregation
4. Add parallel execution support
5. Create CLI: `opencode test run`
6. Add result output formats
7. Implement fail-on-error mode

**Files to Create**:
- `packages/opencode/src/evaluation/runner.ts`
- `packages/opencode/src/cli/cmd/test.ts`

---

### Stream 6: Scorecards (2 hours)
**Depends on**: Stream 3

**Steps**:
1. Create scorecard schema
2. Implement scorecard evaluator
3. Build 2-3 built-in scorecards
4. Add scorecard storage
5. Create scorecard CLI
6. Integrate with test runner

**Files to Create**:
- `packages/opencode/src/evaluation/scorecard.ts`
- `packages/opencode/src/evaluation/scorecards/builtin.ts`

---

### Stream 7: CLI Integration (Ongoing, 1-2 hours)
**Parallel with all streams**

**Steps**:
1. Create `opencode eval` command group
2. Add `opencode eval trace <session-id>`
3. Add `opencode eval run <metric-id> <trace-id>`
4. Create `opencode dataset` command group
5. Create `opencode test` command group
6. Add pretty formatting
7. Create help documentation

**Files to Create/Modify**:
- `packages/opencode/src/cli/cmd/eval.ts`
- Update `packages/opencode/src/index.ts` to register commands

---

### Stream 8: CI/CD Integration (1-2 hours)
**Depends on**: Streams 5 & 6

**Steps**:
1. Create GitHub Action workflow example
2. Add PR comment formatting
3. Implement baseline comparison
4. Add regression detection
5. Create CI-friendly output formats
6. Document setup guide

**Files to Create**:
- `.github/workflows/eval-example.yml`
- `docs/ci-integration.md`

---

## Implementation Timeline

**Already Complete**: 
- ✅ Trace Foundation (Stream 1)
- ✅ Implementation plan documents
- ✅ Ontology design

**Remaining Work**: ~16-20 hours
- Stream 2: Metric Registry (2-3h)
- Stream 3: Evaluation Engine (3-4h)  
- Stream 4: Dataset Management (2-3h)
- Stream 5: Test Runner (3-4h)
- Stream 6: Scorecards (2h)
- Stream 7: CLI Integration (1-2h)
- Stream 8: CI/CD Integration (1-2h)

---

## How to Continue

### Option 1: Sequential Implementation
Implement streams in dependency order:
1. Stream 2 (Metrics)
2. Stream 3 (Engine)
3. Streams 4 + 6 in parallel
4. Stream 5
5. Streams 7 + 8

### Option 2: MVP First
Build minimal viable product:
1. Stream 2: Just 3 metrics (error-rate, latency, cost)
2. Stream 3: Basic engine (heuristics only)
3. Stream 7: Simple CLI (`opencode eval trace`)
4. Test and iterate

### Option 3: Parallel Teams
If multiple developers:
- Dev 1: Streams 2 → 3 → 6
- Dev 2: Stream 4 → 5
- Dev 3: Stream 7 (ongoing)

---

## Key Design Decisions Made

1. **Traces are immutable** - Once materialized, they don't change
2. **Evaluations are separate** - Can evaluate/re-evaluate traces anytime
3. **Storage is local-first** - All data in project storage
4. **Events for observability** - Bus system for real-time notifications
5. **Progressive disclosure** - Simple cases work out of box, complex cases supported

---

## Testing Strategy

Each stream should include:
1. Unit tests for core logic
2. Integration tests with storage
3. CLI tests for user-facing commands
4. Example usage in docs

---

## Success Metrics

### Phase 1 (Streams 1-3)
- [ ] Can materialize traces from sessions
- [ ] Can evaluate traces with built-in metrics
- [ ] Can query evaluation history

### Phase 2 (Streams 4-5)
- [ ] Can create and run test datasets
- [ ] Assertions work correctly
- [ ] Results are actionable

### Phase 3 (Streams 6-8)
- [ ] Scorecards enforce quality gates
- [ ] CI integration blocks bad PRs
- [ ] Documentation is complete

---

## Next Command to Run

To continue implementation:

```bash
# Stream 2: Create metric registry
cd packages/opencode/src
mkdir -p evaluation/metrics
```

Then create the files outlined in Stream 2 above.
