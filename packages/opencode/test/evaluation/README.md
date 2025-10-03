# Evaluation Test Utilities

This directory contains realistic test fixtures and utilities for testing the evaluation framework with production-like data patterns.

## Overview

The test utilities consist of:

1. **Realistic Trace Fixtures** (`fixtures/realistic-traces.ts`) - Pre-built trace patterns based on actual agent behavior
2. **Time-Series Simulator** (`helpers/time-series-simulation.ts`) - Generate temporal patterns and trends
3. **Scenario Tests** (`realistic-scenarios.test.ts`) - Real-world end-to-end test scenarios

## Realistic Trace Fixtures

Located in `fixtures/realistic-traces.ts`, these provide production-like trace patterns:

### Available Patterns

```typescript
import { RealisticTraces } from './fixtures/realistic-traces'

// Common successful workflow (Read → Grep → Edit → Execute)
const trace = RealisticTraces.successfulCodeEdit()

// Failed operation with retry pattern
const trace = RealisticTraces.failedWithRetry()

// Long-running complex refactoring
const trace = RealisticTraces.complexRefactoring()

// Cache-heavy execution (90% cost reduction)
const trace = RealisticTraces.cachedExecution()

// Deep reasoning task (high reasoning tokens)
const trace = RealisticTraces.deepReasoning()

// Quick simple fix
const trace = RealisticTraces.quickFix()

// High error rate debugging session
const trace = RealisticTraces.highErrorRate()

// Faster/cheaper Haiku model
const trace = RealisticTraces.haikuModel()
```

### Generating Variations

```typescript
// Generate 10 traces with 15% variance around base pattern
const traces = RealisticTraces.generateVariations(
  RealisticTraces.successfulCodeEdit,
  10,
  0.15
)

// Create custom trace with specific overrides
const customTrace = RealisticTraces.custom({
  summary: {
    cost: 0.05,
    duration: 5000,
  }
})
```

## Time-Series Simulator

Located in `helpers/time-series-simulation.ts`, generates realistic temporal patterns:

### Temporal Patterns

```typescript
import { TimeSeriesSimulator } from './helpers/time-series-simulation'

// Daily pattern: business hours (9-5) have 1.5x load
const traces = TimeSeriesSimulator.dailyPattern(
  7,    // days
  24,   // samples per day
  0.02, // base cost
  0.1   // 10% variance
)

// Gradual degradation: 5% performance decline
const traces = TimeSeriesSimulator.degradation(
  100,   // samples
  0.05,  // 5% degradation rate
  0.02   // base cost
)

// Spike pattern: sudden anomaly
const traces = TimeSeriesSimulator.withSpike(
  100,  // normal samples
  5     // 5x spike intensity
)

// Weekly seasonal pattern: weekends have 30% of weekday load
const traces = TimeSeriesSimulator.seasonal(
  4,    // weeks
  10,   // samples per day
  0.02  // base cost
)

// Linear trend: steady improvement or degradation
const traces = TimeSeriesSimulator.linearTrend(
  100,   // samples
  0.04,  // start cost
  0.02   // end cost (improving)
)

// Stable pattern with minimal variance
const traces = TimeSeriesSimulator.stable(
  100,   // samples
  0.02,  // cost
  0.02   // 2% variance
)

// Bimodal distribution: cached vs uncached
const traces = TimeSeriesSimulator.bimodal(
  100,   // samples
  0.01,  // cached cost
  0.05,  // uncached cost
  0.7    // 70% cached
)

// A/B test with two populations
const { groupA, groupB } = TimeSeriesSimulator.abTest(
  50,    // samples per group
  0.02,  // group A cost
  0.028, // group B cost (40% worse)
  0.1    // 10% variance
)

// Step function: sudden deployment change
const traces = TimeSeriesSimulator.stepFunction(
  50,   // samples before
  50,   // samples after
  0.02, // before cost
  0.04  // after cost (2x)
)

// Noisy data: high variance
const traces = TimeSeriesSimulator.noisy(
  100,   // samples
  0.02,  // mean cost
  0.3    // 30% variance
)
```

## Usage Examples

### Testing Anomaly Detection

```typescript
test("detects cost spike", async () => {
  const metric = await Metric.register({
    id: "cost-monitoring",
    evaluator: { type: "heuristic", function: "totalCost" },
  })

  // Generate stable baseline
  const stableTraces = TimeSeriesSimulator.stable(50, 0.02, 0.02)
  for (const trace of stableTraces) {
    await TimeSeries.record(metric.id, trace)
  }

  // Test with anomalous trace
  const anomaly = RealisticTraces.custom({
    summary: { cost: 0.20 } // 10x normal
  })

  const result = await TimeSeries.detectAnomaly(metric.id, anomaly.summary.cost)
  expect(result.isAnomaly).toBe(true)
  expect(result.zScore).toBeGreaterThan(3)
})
```

### Testing Baseline Regression

```typescript
test("detects performance regression", async () => {
  const metric = await Metric.register({
    id: "duration-tracking",
    evaluator: { type: "heuristic", function: "responseDuration" },
  })

  // Create baseline with fast Haiku traces
  const baseline = await Baseline.create({
    id: "fast-baseline",
    metricIDs: [metric.id],
  })

  const fastTraces = RealisticTraces.generateVariations(
    RealisticTraces.haikuModel,
    10,
    0.1
  )
  
  for (const trace of fastTraces) {
    await Baseline.addTrace(baseline.id, trace)
  }

  // Test slower Sonnet trace
  const slowTrace = RealisticTraces.successfulCodeEdit()
  const comparison = await Baseline.compare(baseline.id, slowTrace)

  expect(comparison.regressions).toContain(metric.id)
})
```

### Testing Trend Analysis

```typescript
test("detects improving trend", async () => {
  const metric = await Metric.register({
    id: "optimization-tracking",
    evaluator: { type: "heuristic", function: "totalCost" },
  })

  // Simulate optimization: cost decreases 30%
  const traces = TimeSeriesSimulator.linearTrend(
    100,  // samples
    0.03, // start (expensive)
    0.02  // end (optimized)
  )

  for (const trace of traces) {
    await TimeSeries.record(metric.id, trace)
  }

  const analysis = await TimeSeries.analyzeTrend(metric.id, { days: 4 })
  expect(analysis.trend).toBe("improving")
  expect(analysis.changePercent).toBeLessThan(-20) // >20% improvement
})
```

### Testing A/B Comparison

```typescript
test("compares model variants", async () => {
  const metric = await Metric.register({
    id: "ab-test",
    evaluator: { type: "heuristic", function: "totalCost" },
  })

  const { groupA, groupB } = TimeSeriesSimulator.abTest(
    30,    // samples
    0.020, // variant A
    0.028, // variant B (40% worse)
    0.1    // variance
  )

  const baselineA = await Baseline.create({
    id: "variant-a",
    metricIDs: [metric.id],
  })

  const baselineB = await Baseline.create({
    id: "variant-b",
    metricIDs: [metric.id],
  })

  for (const trace of groupA) {
    await Baseline.addTrace(baselineA.id, trace)
  }

  for (const trace of groupB) {
    await Baseline.addTrace(baselineB.id, trace)
  }

  const comparison = await Baseline.compareAB(baselineA.id, baselineB.id)
  
  // B should be significantly worse
  expect(comparison.metrics[0].percentChange).toBeGreaterThan(30)
  expect(comparison.metrics[0].winner).toBe("A")
})
```

## Realistic Cost Values

All traces use realistic Claude pricing based on token usage:

- **Quick Fix**: $0.0045 (300 input + 100 output tokens)
- **Successful Edit**: $0.0245 (1,250 input + 450 output tokens)
- **Cached Execution**: $0.0089 (heavy cache reads)
- **Complex Refactoring**: $0.1850 (8,500 input + 2,100 output tokens)
- **Deep Reasoning**: $0.0680 (5,000 reasoning tokens)
- **Failed with Retry**: $0.0520 (~2x normal due to retries)
- **Haiku Model**: $0.0018 (much cheaper/faster)

## Realistic Duration Values

Based on observed agent behavior:

- **Quick Fix**: 600ms
- **Successful Edit**: 2,150ms  
- **Complex Refactoring**: 15,000ms
- **Haiku Model**: 400ms (much faster)
- **Failed with Retry**: 3,200ms (includes retry delays)

## Tool Call Patterns

Realistic sequences based on common workflows:

- **Code Edit**: Read → Grep → Edit → Execute
- **Multi-file Refactor**: Grep → Read (3x) → Grep → MultiEdit (2x) → Execute (2x) → Read
- **Quick Fix**: Read → Edit
- **Debugging**: Execute (multiple, with retries)

## Best Practices

1. **Use variations for realistic noise**: `generateVariations()` adds 10-20% variance
2. **Match patterns to scenarios**: Use appropriate trace types for your test
3. **Consider temporal patterns**: Use TimeSeriesSimulator for time-based tests
4. **Test edge cases**: Combine patterns (e.g., degradation + spikes)
5. **Validate with real data**: Compare fixture costs/durations to production metrics

## Contributing

When adding new fixtures:
1. Base them on real production patterns
2. Use realistic token counts and pricing
3. Include proper tool call sequences
4. Document the scenario being modeled
5. Add variance options where appropriate
