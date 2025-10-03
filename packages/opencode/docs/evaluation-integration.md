# Evaluation Framework Integration Guide

This guide shows how to deeply integrate the evaluation framework with baseline tracking, time-series analysis, and automatic monitoring.

## Architecture Overview

```
┌─────────────┐
│   Trace     │ Completed
│ Completion  │──────────┐
└─────────────┘          │
                         ▼
              ┌──────────────────────┐
              │ EvaluationIntegration│
              │   (Auto-Processor)   │
              └──────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Evaluation  │ │  TimeSeries  │ │   Baseline   │
│    Engine    │ │   Tracking   │ │  Comparison  │
└──────────────┘ └──────────────┘ └──────────────┘
        │                │                │
        └────────────────┼────────────────┘
                         ▼
              ┌──────────────────────┐
              │   Alert Generation   │
              │  (Regression/Anomaly)│
              └──────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   Notifications &    │
              │      Dashboard       │
              └──────────────────────┘
```

## Quick Start

### 1. Define Metrics

First, register the metrics you want to track:

```typescript
import { Metric } from "@opencode/evaluation"

// Register metrics
await Metric.register({
  id: "error-rate",
  name: "Error Rate",
  description: "Percentage of tool calls that failed",
  version: "1.0.0",
  category: "reliability",
  evaluator: { type: "heuristic", function: "toolErrorRate" },
  higherIsBetter: false,
  threshold: { pass: 0.05 }, // Max 5% error rate
})

await Metric.register({
  id: "latency",
  name: "Response Time",
  description: "Total trace duration in milliseconds",
  version: "1.0.0",
  category: "performance",
  evaluator: { type: "heuristic", function: "duration" },
  higherIsBetter: false,
  threshold: { pass: 5000 }, // Max 5 seconds
})

await Metric.register({
  id: "cost",
  name: "Total Cost",
  description: "Sum of all LLM API costs",
  version: "1.0.0",
  category: "cost",
  evaluator: { type: "heuristic", function: "totalCost" },
  higherIsBetter: false,
})
```

### 2. Create Baselines

Establish performance baselines from production traces:

```typescript
import { Baseline } from "@opencode/evaluation"

// Create production baseline
const prodBaseline = await Baseline.create({
  id: "prod-baseline-v1",
  name: "Production Baseline v1",
  description: "Reference performance from Oct 2024",
  metricIDs: ["error-rate", "latency", "cost"],
  minSampleSize: 20,
  regressionThreshold: 0.15, // 15% degradation triggers alert
  tags: ["production", "v1"],
})

// Add historical traces to baseline
const historicalTraces = await Trace.list({ 
  since: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
  hasErrors: false, // Only successful traces
})

for await (const trace of historicalTraces) {
  await Baseline.addTrace(prodBaseline.id, trace)
}

console.log(`Baseline created with ${prodBaseline.traceIDs.length} traces`)
```

### 3. Enable Auto-Evaluation

Set up automatic evaluation and monitoring:

```typescript
import { EvaluationIntegration } from "@opencode/evaluation"

// Enable auto-evaluation
await EvaluationIntegration.enableAutoEvaluation({
  metricIDs: ["error-rate", "latency", "cost"],
  recordTimeSeries: true,      // Track trends over time
  checkBaselines: true,         // Compare against baseline
  detectAnomalies: true,        // Detect statistical outliers
  anomalyThreshold: 3,          // 3-sigma rule
  tags: {
    environment: "production",
    version: "1.0.0",
  },
})

console.log("Auto-evaluation enabled")
```

### 4. Set Up Alerts

Register callbacks for different alert types:

```typescript
// Monitor regressions
EvaluationIntegration.onRegression((alert) => {
  console.error(`🔴 REGRESSION DETECTED`)
  console.error(`  Metric: ${alert.metricID}`)
  console.error(`  Trace: ${alert.traceID}`)
  console.error(`  Baseline: ${alert.baselineValue.toFixed(3)}`)
  console.error(`  Current: ${alert.currentValue.toFixed(3)}`)
  console.error(`  Change: ${alert.percentChange.toFixed(1)}%`)
  
  // Send to alerting system
  sendSlackAlert(`Regression in ${alert.metricID}: ${alert.percentChange.toFixed(1)}% worse`)
  createJiraTicket(alert)
})

// Monitor anomalies
EvaluationIntegration.onAnomaly((alert) => {
  console.warn(`⚠️  ANOMALY DETECTED`)
  console.warn(`  Metric: ${alert.metricID}`)
  console.warn(`  Current: ${alert.currentValue.toFixed(3)}`)
  console.warn(`  Expected: ${alert.expectedRange.min.toFixed(3)} - ${alert.expectedRange.max.toFixed(3)}`)
  console.warn(`  Z-Score: ${alert.zScore.toFixed(2)}σ`)
  
  // Log for investigation
  logAnomalyForInvestigation(alert)
})

// Celebrate improvements
EvaluationIntegration.onImprovement((alert) => {
  console.log(`🎉 IMPROVEMENT DETECTED`)
  console.log(`  Metric: ${alert.metricID}`)
  console.log(`  Change: ${Math.abs(alert.percentChange).toFixed(1)}% better`)
  
  // Track wins
  recordMetricsImprovement(alert)
})
```

## Advanced Usage

### A/B Testing

Compare two different agent configurations:

```typescript
// Create baseline for version A
const baselineA = await Baseline.create({
  id: "agent-v1-baseline",
  name: "Agent v1 Baseline",
  description: "Performance of original agent",
  metricIDs: ["error-rate", "latency", "cost"],
  minSampleSize: 30,
  tags: ["v1"],
})

// Create baseline for version B
const baselineB = await Baseline.create({
  id: "agent-v2-baseline",
  name: "Agent v2 Baseline",  
  description: "Performance with new prompt",
  metricIDs: ["error-rate", "latency", "cost"],
  minSampleSize: 30,
  tags: ["v2"],
})

// Collect data for both versions...
// (run production traffic through both)

// Compare after sufficient samples
const abResult = await Baseline.compareAB(baselineA.id, baselineB.id)

console.log(`A/B Test Results`)
console.log(`  Overall Winner: ${abResult.overallWinner}`)
console.log(`  Sample Sizes: A=${abResult.sampleSizeA}, B=${abResult.sampleSizeB}`)
console.log(`\nMetric Breakdown:`)

for (const metric of abResult.metrics) {
  console.log(`  ${metric.metricID}:`)
  console.log(`    Winner: ${metric.winner}`)
  console.log(`    A: ${metric.meanA.toFixed(3)}, B: ${metric.meanB.toFixed(3)}`)
  console.log(`    Change: ${metric.percentChange.toFixed(1)}%`)
  console.log(`    Confidence: ${(metric.confidence * 100).toFixed(1)}%`)
}

// Roll out winner to 100% traffic
if (abResult.overallWinner === "B") {
  deployVersion("v2")
}
```

### Trend Analysis

Analyze performance trends over time:

```typescript
// Analyze error rate trend over last 30 days
const errorTrend = await TimeSeries.analyzeTrend("error-rate", {
  days: 30,
  anomalyThreshold: 2, // 2-sigma for anomaly detection
})

console.log(`Error Rate Trend Analysis`)
console.log(`  Trend: ${errorTrend.trend}`) // "improving", "degrading", or "stable"
console.log(`  Strength: ${(errorTrend.trendStrength * 100).toFixed(1)}%`)
console.log(`  Slope: ${errorTrend.slope.toFixed(6)}/day`)
console.log(`  Overall Change: ${errorTrend.changePercent.toFixed(1)}%`)
console.log(`  Anomalies: ${errorTrend.anomalies.length}`)

if (errorTrend.trend === "degrading") {
  console.warn(`⚠️  Error rate has been degrading over last 30 days`)
  investigateDegradation(errorTrend)
}

// Detect anomalies in real-time
const currentErrorRate = 0.08 // 8%
const anomalyCheck = await TimeSeries.detectAnomaly("error-rate", currentErrorRate, 14)

if (anomalyCheck.isAnomaly) {
  console.error(`Current error rate ${currentErrorRate} is anomalous!`)
  console.error(`  Expected range: ${anomalyCheck.expectedRange.min.toFixed(3)} - ${anomalyCheck.expectedRange.max.toFixed(3)}`)
  console.error(`  Historical mean: ${anomalyCheck.historicalMean.toFixed(3)}`)
}
```

### Dashboard Integration

Build a monitoring dashboard:

```typescript
// Get dashboard data for visualization
const dashboard = await EvaluationIntegration.getDashboard({
  since: Date.now() - 30 * 24 * 60 * 60 * 1000, // Last 30 days
  metricIDs: ["error-rate", "latency", "cost"],
  period: "day", // Daily aggregates
})

// Render dashboard
for (const metric of dashboard.metrics) {
  console.log(`\n${metric.metric.name}`)
  console.log(`  Data Points: ${metric.dataPoints}`)
  
  if (metric.trend) {
    console.log(`  Trend: ${metric.trend.trend} (${(metric.trend.trendStrength * 100).toFixed(1)}%)`)
    console.log(`  30-day Change: ${metric.trend.changePercent.toFixed(1)}%`)
  }
  
  console.log(`  Last 10 Days:`)
  for (const agg of metric.aggregates.slice(-10)) {
    const date = new Date(agg.periodStart).toLocaleDateString()
    console.log(`    ${date}: ${agg.mean.toFixed(3)} (min: ${agg.min.toFixed(3)}, max: ${agg.max.toFixed(3)})`)
  }
  
  console.log(`  Baselines:`)
  for (const baseline of metric.baselines) {
    if (baseline.statistics) {
      console.log(`    ${baseline.name}: ${baseline.statistics.mean.toFixed(3)} ± ${baseline.statistics.stdDev.toFixed(3)}`)
    }
  }
}
```

### Historical Re-evaluation

Re-evaluate old traces after updating metrics:

```typescript
// Get all traces from last month
const traces = await Trace.list({
  since: Date.now() - 30 * 24 * 60 * 60 * 1000,
})

const traceIDs = []
for await (const trace of traces) {
  traceIDs.push(trace.id)
}

console.log(`Re-evaluating ${traceIDs.length} historical traces`)

// Batch evaluate with new metrics
await EvaluationIntegration.evaluateTraces(traceIDs, {
  metricIDs: ["new-metric-v2", "error-rate", "latency"],
  recordTimeSeries: true,
  checkBaselines: false, // Don't alert on historical data
})

console.log(`Historical evaluation complete`)
```

### Custom Alert Routing

Route alerts to different channels based on severity:

```typescript
EvaluationIntegration.onAlert((alert) => {
  // Route based on alert type and severity
  switch (alert.type) {
    case "regression":
      if (Math.abs(alert.percentChange) > 50) {
        // Critical regression
        sendPagerDuty({
          severity: "critical",
          summary: `Critical regression in ${alert.metricID}`,
          details: alert,
        })
      } else if (Math.abs(alert.percentChange) > 20) {
        // Major regression
        sendSlack({
          channel: "#incidents",
          text: `⚠️ Major regression in ${alert.metricID}: ${alert.percentChange.toFixed(1)}% worse`,
          alert,
        })
      } else {
        // Minor regression
        sendSlack({
          channel: "#metrics",
          text: `Regression in ${alert.metricID}: ${alert.percentChange.toFixed(1)}% worse`,
          alert,
        })
      }
      break
      
    case "anomaly":
      if (Math.abs(alert.zScore) > 5) {
        // Extreme anomaly
        sendSlack({
          channel: "#incidents",
          text: `🔴 Extreme anomaly in ${alert.metricID}: ${alert.zScore.toFixed(1)}σ`,
          alert,
        })
      } else {
        // Normal anomaly
        logToDatadog("anomaly_detected", alert)
      }
      break
      
    case "improvement":
      // Celebrate improvements
      sendSlack({
        channel: "#wins",
        text: `🎉 Improvement in ${alert.metricID}: ${Math.abs(alert.percentChange).toFixed(1)}% better!`,
        alert,
      })
      break
  }
})
```

## Best Practices

### 1. Baseline Management

- **Create separate baselines** for different environments (dev, staging, prod)
- **Version your baselines** when making significant agent changes
- **Maintain minimum sample sizes** (>20 traces) for statistical significance
- **Update baselines regularly** to reflect expected performance

```typescript
// Environment-specific baselines
await Baseline.create({
  id: "prod-baseline",
  tags: ["production", "us-east-1"],
  minSampleSize: 50,
  regressionThreshold: 0.10, // Strict for prod
})

await Baseline.create({
  id: "staging-baseline",
  tags: ["staging"],
  minSampleSize: 20,
  regressionThreshold: 0.25, // More lenient for staging
})
```

### 2. Metric Selection

- **Start with core metrics**: error rate, latency, cost
- **Add domain-specific metrics** gradually
- **Avoid metric overload**: 5-10 key metrics is usually sufficient
- **Group related metrics** using tags

### 3. Alert Tuning

- **Start with conservative thresholds** to avoid alert fatigue
- **Adjust based on false positive rate**
- **Use different thresholds** for different metrics
- **Implement alert deduplication** for noisy metrics

### 4. Time-Series Analysis

- **Use appropriate time windows**: 
  - Anomaly detection: 7-14 days
  - Trend analysis: 30-90 days
- **Consider seasonality**: weekday vs weekend patterns
- **Filter outliers** when establishing baselines

### 5. Performance

- **Batch historical evaluations** during off-peak hours
- **Use tags** to filter time-series queries
- **Archive old data** periodically
- **Index frequently queried fields**

## Integration with CI/CD

### Pre-Deployment Checks

```typescript
// In CI/CD pipeline, before deployment
async function preDeploymentCheck() {
  // Evaluate test traces against new code
  const testTraces = await runIntegrationTests()
  
  for (const trace of testTraces) {
    await EvaluationIntegration.evaluateTrace(trace.id, {
      metricIDs: ["error-rate", "latency", "cost"],
      checkBaselines: true,
    })
  }
  
  // Check if any regressions detected
  let hasRegressions = false
  
  const unsubscribe = EvaluationIntegration.onRegression((alert) => {
    console.error(`Blocking deployment: regression in ${alert.metricID}`)
    hasRegressions = true
  })
  
  // Wait for async processing
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  unsubscribe()
  
  if (hasRegressions) {
    throw new Error("Deployment blocked due to regressions")
  }
  
  console.log("✅ No regressions detected, proceeding with deployment")
}
```

### Post-Deployment Monitoring

```typescript
// Monitor for 1 hour after deployment
async function postDeploymentMonitor(deploymentID: string) {
  console.log(`Monitoring deployment ${deploymentID}`)
  
  const alerts: Alert[] = []
  const unsubscribe = EvaluationIntegration.onAlert((alert) => {
    alerts.push(alert)
  })
  
  // Wait 1 hour
  await new Promise(resolve => setTimeout(resolve, 60 * 60 * 1000))
  
  unsubscribe()
  
  // Check alert counts
  const regressions = alerts.filter(a => a.type === "regression")
  const anomalies = alerts.filter(a => a.type === "anomaly")
  
  if (regressions.length > 5 || anomalies.length > 10) {
    console.error(`Deployment ${deploymentID} showing issues, consider rollback`)
    console.error(`  Regressions: ${regressions.length}`)
    console.error(`  Anomalies: ${anomalies.length}`)
    
    return { healthy: false, alerts }
  }
  
  console.log(`✅ Deployment ${deploymentID} healthy`)
  return { healthy: true, alerts }
}
```

## Troubleshooting

### No Alerts Being Generated

1. Check auto-evaluation is enabled:
```typescript
EvaluationIntegration.disableAutoEvaluation()
await EvaluationIntegration.enableAutoEvaluation({ /* config */ })
```

2. Verify metrics are registered:
```typescript
const metric = await Metric.get("your-metric-id")
console.log(metric)
```

3. Check baseline sample sizes:
```typescript
const baseline = await Baseline.get("your-baseline-id")
console.log(`Sample size: ${baseline.traceIDs.length} (min: ${baseline.minSampleSize})`)
```

### Too Many False Positive Alerts

1. Increase regression threshold:
```typescript
await Baseline.update("baseline-id", {
  regressionThreshold: 0.25, // From 0.15 to 0.25
})
```

2. Increase anomaly threshold:
```typescript
await EvaluationIntegration.enableAutoEvaluation({
  // ... other config
  anomalyThreshold: 4, // From 3 to 4 sigma
})
```

3. Increase baseline sample size:
```typescript
await Baseline.update("baseline-id", {
  minSampleSize: 50, // From 20 to 50
})
```

### Missing Time-Series Data

1. Verify recording is enabled:
```typescript
await EvaluationIntegration.enableAutoEvaluation({
  // ... other config
  recordTimeSeries: true,
})
```

2. Check for evaluation errors:
```typescript
// Look for error logs in evaluation engine
```

3. Manually record test data:
```typescript
const trace = await Trace.get("trace-id")
await TimeSeries.record("metric-id", trace, { tag: "test" })
```

## Next Steps

- Explore [Metric Definitions](./metrics.md) for creating custom metrics
- Learn about [Heuristic Functions](./heuristics.md) for built-in evaluators
- See [Dataset Testing](./datasets.md) for test suite management
- Review [API Reference](./api-reference.md) for detailed documentation
