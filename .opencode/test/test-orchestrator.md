# Orchestrator Integration Test

## Test 1: Simple Orchestration

**Input:**
```
Launch a product for Nike
```

**Expected:**
1. Planner creates plan file
2. 3+ workers spawn in parallel
3. Reviewer validates
4. Complete deliverable pack returned

**Pass criteria:**
- No user input requested
- Plan file created at .opencode/plan/current.md
- Multiple Task tool calls in single message
- Final output includes deliverable structure

## Test 2: Parallel Execution

**Input:**
```
Create a Christmas campaign with ads, emails, and social content
```

**Expected:**
1. Planner identifies 3+ independent work units
2. Workers for ads, emails, social spawn simultaneously
3. All complete without sequential blocking

**Pass criteria:**
- Task tool calls are parallel (single message)
- Total time < sum of individual times

## Test 3: Failure Recovery

**Input:**
```
Launch product (with simulated Space failure)
```

**Expected:**
1. One worker fails
2. Reviewer identifies failure
3. Planner spawns retry worker
4. Eventually completes

**Pass criteria:**
- Failure logged in plan file
- Retry attempted
- Final status reflects recovery

## Test 4: Specialist Delegation

**Input:**
```
Analyze Nike Q4 performance and create optimization strategy
```

**Expected:**
1. Planner creates plan with data + strategy units
2. Worker delegates to @analyst for data
3. Worker delegates to @strategist for strategy
4. Both complete

**Pass criteria:**
- @analyst called via Task tool
- @strategist called via Task tool
- Combined results in final output

## Running Tests

To run these tests manually:

1. Start OpenCode: `bun dev`
2. Switch to @planner agent
3. Execute each test input
4. Verify pass criteria

## Automated Testing (Future)

These tests can be automated by:
1. Capturing session transcripts
2. Asserting on tool calls made
3. Validating plan file state
4. Checking final output structure
