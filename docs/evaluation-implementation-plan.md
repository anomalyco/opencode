# Evaluation Framework Implementation Plan

## Work Stream 1: Trace Foundation (Core Data Layer)
**Goal**: Materialize sessions into complete traces with evaluation context

### Steps:
1. ✅ Create trace namespace and types
2. ✅ Implement trace materialization from session
3. ✅ Add trace storage layer
4. ✅ Create trace list/get APIs
5. ✅ Add trace completion event

**Parallel with**: Stream 2 (Metric definitions are independent)

---

## Work Stream 2: Metric Registry (Evaluation Criteria)
**Goal**: Define what we evaluate and how

### Steps:
1. ✅ Create metric schema and types
2. ✅ Implement metric registry (CRUD)
3. ✅ Build 5-7 built-in metrics (heuristics)
4. ✅ Create rule-based evaluator
5. ✅ Add metric storage
6. ✅ Create metric versioning system

**Parallel with**: Stream 1 (doesn't need traces to define metrics)

---

## Work Stream 3: Evaluation Engine (The Executor)
**Goal**: Run metrics against traces and store results

### Steps:
1. ✅ Create evaluation result schema
2. ✅ Implement heuristic evaluator
3. ✅ Implement rule evaluator
4. ✅ Build evaluation engine orchestrator
5. ✅ Add evaluation storage
6. ✅ Create evaluation query API
7. ✅ Emit evaluation events

**Depends on**: Streams 1 & 2 complete

---

## Work Stream 4: Dataset Management (Test Cases)
**Goal**: Store and manage test case collections

### Steps:
1. ✅ Create dataset schema
2. ✅ Implement dataset CRUD
3. ✅ Create test case schema with assertions
4. ✅ Build dataset storage layer
5. ✅ Add dataset CLI commands
6. ✅ Create dataset import/export

**Parallel with**: Stream 3 (independent data model)

---

## Work Stream 5: Test Runner (Execute & Evaluate)
**Goal**: Run datasets and evaluate results

### Steps:
1. ✅ Create test execution engine
2. ✅ Implement assertion framework
3. ✅ Build test result aggregation
4. ✅ Add parallel execution support
5. ✅ Create CLI: `opencode test run`
6. ✅ Add result output formats (JSON, pretty)
7. ✅ Implement fail-on-error mode

**Depends on**: Streams 3 & 4 complete

---

## Work Stream 6: Scorecards (Quality Gates)
**Goal**: Bundle metrics into pass/fail contracts

### Steps:
1. ✅ Create scorecard schema
2. ✅ Implement scorecard evaluator
3. ✅ Build 2-3 built-in scorecards
4. ✅ Add scorecard storage
5. ✅ Create scorecard CLI
6. ✅ Integrate with test runner

**Depends on**: Stream 3 complete
**Parallel with**: Stream 5 (can build while test runner develops)

---

## Work Stream 7: CLI Integration (Developer UX)
**Goal**: Make everything accessible via command line

### Steps:
1. ✅ Create `opencode eval` command group
2. ✅ Add `opencode eval trace <session-id>`
3. ✅ Add `opencode eval run <metric-id> <trace-id>`
4. ✅ Create `opencode dataset` command group
5. ✅ Create `opencode test` command group
6. ✅ Add pretty formatting for all outputs
7. ✅ Create help documentation

**Parallel with**: All streams (add CLI as features complete)

---

## Work Stream 8: CI/CD Integration (Automation)
**Goal**: Enable automated quality gates

### Steps:
1. ✅ Create GitHub Action workflow example
2. ✅ Add PR comment formatting
3. ✅ Implement baseline comparison
4. ✅ Add regression detection
5. ✅ Create CI-friendly output formats
6. ✅ Document setup guide

**Depends on**: Streams 5 & 6 complete

---

## Parallelization Strategy

### Phase 1 (Parallel - Start Together)
- **Stream 1** (Trace) - One dev
- **Stream 2** (Metrics) - One dev
- **Stream 4** (Datasets) - One dev

### Phase 2 (Requires Phase 1)
- **Stream 3** (Engine) - Needs Streams 1+2
- **Stream 6** (Scorecards) - Needs Stream 2
- Continue **Stream 7** (CLI) - Add commands as features complete

### Phase 3 (Integration)
- **Stream 5** (Test Runner) - Needs Streams 3+4
- **Stream 8** (CI/CD) - Needs Streams 5+6

---

## Implementation Order (Solo Developer)

1. **Trace Foundation** (2-3 hours)
2. **Metric Registry** (2-3 hours) 
3. **Evaluation Engine** (3-4 hours)
4. **Dataset Management** (2-3 hours)
5. **Test Runner** (3-4 hours)
6. **Scorecards** (2 hours)
7. **CLI Integration** (ongoing, 1-2 hours)
8. **CI/CD Examples** (1-2 hours)

**Total**: 16-24 hours of implementation

---

## Success Criteria

### Stream 1 (Trace)
- [ ] Can materialize any session into a trace
- [ ] Traces stored with full context
- [ ] Can query traces by filters

### Stream 2 (Metrics)
- [ ] 5+ built-in metrics defined
- [ ] Can register custom metrics
- [ ] Metrics are versioned

### Stream 3 (Engine)
- [ ] Can evaluate trace against metric
- [ ] Results stored persistently
- [ ] Can query evaluation history

### Stream 4 (Datasets)
- [ ] Can create/read/update/delete datasets
- [ ] Can add test cases
- [ ] Can import/export JSON

### Stream 5 (Runner)
- [ ] Can run full dataset
- [ ] Assertions work correctly
- [ ] Results show pass/fail clearly

### Stream 6 (Scorecards)
- [ ] Can define quality contracts
- [ ] Can evaluate trace against scorecard
- [ ] Built-in scorecards available

### Stream 7 (CLI)
- [ ] All features accessible via CLI
- [ ] Help text comprehensive
- [ ] Output is readable

### Stream 8 (CI/CD)
- [ ] Example workflow works
- [ ] Can block PRs on failure
- [ ] Results post to PR

---

## Commit Strategy

**Small, Atomic Commits:**
- After each step within a stream
- Push after completing each stream
- Tag major milestones

**Commit Message Format:**
```
<stream>: <what was done>

- Detail 1
- Detail 2
```

Example:
```
trace: implement trace materialization

- Add Trace.Complete type
- Implement materialize() function
- Add storage layer for traces
- Emit trace.completed events
```
