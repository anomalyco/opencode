import type { Metric } from "../metric"

/**
 * Built-in metrics available out of the box
 */
export const BuiltinMetrics: Record<string, Metric.Definition> = {
  "tool-error-rate": {
    id: "tool-error-rate",
    name: "Tool Error Rate",
    description: "Percentage of tool calls that failed",
    version: "1.0.0",
    category: "performance",
    evaluator: {
      type: "heuristic",
      function: "toolErrorRate",
    },
    threshold: {
      pass: 0.1, // <10% errors is acceptable
      warn: 0.05, // <5% is good
    },
    higherIsBetter: false,
    tags: ["reliability", "tools"],
  },

  "response-latency": {
    id: "response-latency",
    name: "Response Latency",
    description: "Total time to complete the request in milliseconds",
    version: "1.0.0",
    category: "performance",
    evaluator: {
      type: "heuristic",
      function: "responseDuration",
    },
    threshold: {
      pass: 30000, // <30s is acceptable
      warn: 10000, // <10s is good
    },
    higherIsBetter: false,
    tags: ["performance", "latency"],
  },

  "redundant-calls": {
    id: "redundant-calls",
    name: "Redundant Tool Calls",
    description: "Number of duplicate/redundant tool calls detected",
    version: "1.0.0",
    category: "correctness",
    evaluator: {
      type: "heuristic",
      function: "redundantCalls",
    },
    threshold: {
      pass: 0, // No redundant calls
    },
    higherIsBetter: false,
    tags: ["efficiency", "tools"],
  },

  "cost-efficiency": {
    id: "cost-efficiency",
    name: "Cost Efficiency",
    description: "Cost per successful tool operation",
    version: "1.0.0",
    category: "cost",
    evaluator: {
      type: "heuristic",
      function: "costEfficiency",
    },
    threshold: {
      pass: 0.05, // <$0.05 per operation
      warn: 0.01, // <$0.01 is good
    },
    higherIsBetter: false,
    tags: ["cost", "efficiency"],
  },

  "token-efficiency": {
    id: "token-efficiency",
    name: "Token Efficiency",
    description: "Ratio of output tokens to total tokens used",
    version: "1.0.0",
    category: "cost",
    evaluator: {
      type: "heuristic",
      function: "tokenEfficiency",
    },
    threshold: {
      pass: 0.2, // At least 20% of tokens are output
      warn: 0.3, // 30%+ is good
    },
    higherIsBetter: true,
    tags: ["cost", "efficiency"],
  },

  "average-tool-duration": {
    id: "average-tool-duration",
    name: "Average Tool Duration",
    description: "Average time per tool call in milliseconds",
    version: "1.0.0",
    category: "performance",
    evaluator: {
      type: "heuristic",
      function: "averageToolDuration",
    },
    threshold: {
      pass: 3000, // <3s average
      warn: 1000, // <1s is good
    },
    higherIsBetter: false,
    tags: ["performance", "tools"],
  },

  "tool-success-rate": {
    id: "tool-success-rate",
    name: "Tool Success Rate",
    description: "Percentage of tool calls that succeeded",
    version: "1.0.0",
    category: "reliability",
    evaluator: {
      type: "heuristic",
      function: "toolSuccessRate",
    },
    threshold: {
      pass: 0.9, // >90% success
      warn: 0.95, // >95% is good
    },
    higherIsBetter: true,
    tags: ["reliability", "tools"],
  },

  "cache-hit-rate": {
    id: "cache-hit-rate",
    name: "Cache Hit Rate",
    description: "Percentage of input tokens served from cache",
    version: "1.0.0",
    category: "cost",
    evaluator: {
      type: "heuristic",
      function: "cacheHitRate",
    },
    threshold: {
      pass: 0.3, // >30% cache hits
      warn: 0.5, // >50% is good
    },
    higherIsBetter: true,
    tags: ["cost", "performance"],
  },

  "total-cost": {
    id: "total-cost",
    name: "Total Cost",
    description: "Total cost of the trace in dollars",
    version: "1.0.0",
    category: "cost",
    evaluator: {
      type: "heuristic",
      function: "totalCost",
    },
    threshold: {
      pass: 1.0, // <$1 per trace
      warn: 0.1, // <$0.10 is good
    },
    higherIsBetter: false,
    tags: ["cost"],
  },

  "has-errors": {
    id: "has-errors",
    name: "Has Errors",
    description: "Whether the trace encountered any errors",
    version: "1.0.0",
    category: "reliability",
    evaluator: {
      type: "heuristic",
      function: "hasErrors",
    },
    threshold: {
      pass: 0, // No errors
    },
    higherIsBetter: false,
    tags: ["reliability"],
  },
}

/**
 * Register all built-in metrics
 */
export async function registerBuiltinMetrics(): Promise<void> {
  const { Metric } = await import("../metric")
  
  for (const metric of Object.values(BuiltinMetrics)) {
    if (!(await Metric.exists(metric.id))) {
      await Metric.register(metric)
    }
  }
}
