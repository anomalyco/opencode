import z from "zod/v4"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import { Log } from "../util/log"
import type { Trace } from "../trace"
import { Dataset } from "./dataset"
import { EvaluationEngine } from "./engine"

/**
 * TestRunner executes test suites and validates trace behavior.
 * 
 * The runner evaluates assertions against traces to determine if they
 * meet expected criteria. It supports:
 * - Running entire datasets of test cases
 * - Evaluating individual assertions against traces
 * - Tracking test history and results
 * - Emitting events for test lifecycle monitoring
 * 
 * Assertion results include pass/fail status, actual vs expected values,
 * and descriptive messages for debugging failures.
 * 
 * @example
 * ```typescript
 * // Run assertions against a trace
 * const assertions = [
 *   { type: "tool-called", toolID: "Read", minCount: 1 },
 *   { type: "duration-under", milliseconds: 5000 },
 *   { type: "no-errors" }
 * ]
 * const results = await TestRunner.runAssertions(trace, assertions)
 * const passed = results.every(r => r.passed)
 * ```
 */
export namespace TestRunner {
  const log = Log.create({ service: "test-runner" })

  export const AssertionResult = z.object({
    assertion: Dataset.Assertion,
    passed: z.boolean(),
    message: z.string(),
    actual: z.any().optional(),
    expected: z.any().optional(),
  })
  export type AssertionResult = z.infer<typeof AssertionResult>

  export const TestResult = z.object({
    testCase: Dataset.TestCase,
    traceID: z.string(),
    passed: z.boolean(),
    
    assertions: z.array(AssertionResult),
    
    duration: z.number(),
    timestamp: z.number(),
    
    error: z.string().optional(),
  })
  export type TestResult = z.infer<typeof TestResult>

  export const RunResult = z.object({
    id: z.string(),
    datasetID: z.string(),
    
    results: z.array(TestResult),
    
    summary: z.object({
      total: z.number(),
      passed: z.number(),
      failed: z.number(),
      duration: z.number(),
    }),
    
    timestamp: z.number(),
  })
  export type RunResult = z.infer<typeof RunResult>

  export const Event = {
    Started: Bus.event(
      "test.started",
      z.object({
        runID: z.string(),
        datasetID: z.string(),
      }),
    ),
    TestCompleted: Bus.event(
      "test.completed",
      z.object({
        runID: z.string(),
        testCaseID: z.string(),
        passed: z.boolean(),
      }),
    ),
    Completed: Bus.event(
      "test.run.completed",
      z.object({
        runID: z.string(),
        summary: RunResult.shape.summary,
      }),
    ),
  }

  /**
   * Run all test cases in a dataset
   */
  export async function run(datasetID: string): Promise<RunResult> {
    const { Dataset } = await import("./dataset")
    const dataset = await Dataset.get(datasetID)
    const testCases = dataset.testCases.filter((tc) => tc.enabled)

    const runID = Date.now().toString() + "-" + Math.random().toString(36).substring(7)
    const startTime = Date.now()

    Bus.publish(Event.Started, { runID, datasetID })

    log.info("starting test run", {
      runID,
      datasetID,
      testCount: testCases.length,
    })

    const results: TestResult[] = []

    for (const testCase of testCases) {
      const result = await runTest(testCase, runID)
      results.push(result)

      Bus.publish(Event.TestCompleted, {
        runID,
        testCaseID: testCase.id,
        passed: result.passed,
      })

      log.info("test completed", {
        testCaseID: testCase.id,
        passed: result.passed,
        assertions: result.assertions.length,
      })
    }

    const endTime = Date.now()
    const passed = results.filter((r) => r.passed).length

    const runResult: RunResult = {
      id: runID,
      datasetID,
      results,
      summary: {
        total: results.length,
        passed,
        failed: results.length - passed,
        duration: endTime - startTime,
      },
      timestamp: startTime,
    }

    // Store the run result
    await Storage.write(["test-run", datasetID, runID], runResult)

    Bus.publish(Event.Completed, {
      runID,
      summary: runResult.summary,
    })

    log.info("test run completed", {
      runID,
      summary: runResult.summary,
    })

    return runResult
  }

  /**
   * Run a single test case
   */
  async function runTest(testCase: Dataset.TestCase, _runID: string): Promise<TestResult> {
    const startTime = Date.now()

    try {
      // For now, we need a trace to evaluate assertions
      // In a full implementation, this would execute the agent with the test input
      // and create a new trace. For now, we'll document this limitation.
      
      // TODO: Implement agent execution here
      // const trace = await executeAgent(testCase.input.prompt, testCase.input.context)
      
      // Placeholder: We'll need to provide a way to link test cases to existing traces
      // or execute the agent to create new traces
      throw new Error("Test execution requires agent integration - not yet implemented")

    } catch (error) {
      return {
        testCase,
        traceID: "",
        passed: false,
        assertions: [],
        duration: Date.now() - startTime,
        timestamp: startTime,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Run assertions against a trace.
   * 
   * Evaluates all provided assertions and returns results with
   * pass/fail status, actual vs expected values, and messages.
   * 
   * @param trace - The completed trace to validate
   * @param assertions - Array of assertions to evaluate
   * @returns Array of assertion results with pass/fail status
   * 
   * @example
   * ```typescript
   * const assertions = [
   *   { type: "tool-called", toolID: "Edit", minCount: 1, maxCount: 3 },
   *   { type: "output-contains", substring: "success" },
   *   { type: "cost-under", dollars: 0.05 }
   * ]
   * const results = await TestRunner.runAssertions(trace, assertions)
   * results.forEach(r => {
   *   console.log(`${r.passed ? '✓' : '✗'} ${r.message}`)
   * })
   * ```
   */
  export async function runAssertions(trace: Trace.Complete, assertions: Dataset.Assertion[]): Promise<AssertionResult[]> {
    return Promise.all(assertions.map((assertion) => checkAssertion(trace, assertion)))
  }

  /**
   * Check a single assertion
   */
  async function checkAssertion(trace: Trace.Complete, assertion: Dataset.Assertion): Promise<AssertionResult> {
    try {
      switch (assertion.type) {
        case "tool-called":
          return checkToolCalled(trace, assertion)
        case "output-matches":
          return checkOutputMatches(trace, assertion)
        case "output-contains":
          return checkOutputContains(trace, assertion)
        case "no-errors":
          return checkNoErrors(trace)
        case "duration-under":
          return checkDurationUnder(trace, assertion)
        case "cost-under":
          return checkCostUnder(trace, assertion)
        case "metric-passes":
          return checkMetricPasses(trace, assertion)
        case "custom":
          return checkCustom(trace, assertion)
      }
    } catch (error) {
      return {
        assertion,
        passed: false,
        message: `Assertion check failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  function checkToolCalled(trace: Trace.Complete, assertion: Dataset.Assertion & { type: "tool-called" }): AssertionResult {
    const calls = trace.toolCalls.filter((tc) => tc.id === assertion.toolID)
    const count = calls.length

    const minCount = assertion.minCount ?? 1
    const maxCount = assertion.maxCount ?? Infinity

    const passed = count >= minCount && count <= maxCount

    return {
      assertion,
      passed,
      message: passed
        ? `Tool '${assertion.toolID}' called ${count} time(s)`
        : `Tool '${assertion.toolID}' called ${count} time(s), expected ${minCount} to ${maxCount === Infinity ? "∞" : maxCount}`,
      actual: count,
      expected: { min: minCount, max: maxCount },
    }
  }

  function checkOutputMatches(trace: Trace.Complete, assertion: Dataset.Assertion & { type: "output-matches" }): AssertionResult {
    const output = trace.output

    const regex = new RegExp(assertion.pattern, assertion.flags)
    const passed = regex.test(output)

    return {
      assertion,
      passed,
      message: passed
        ? `Output matches pattern: ${assertion.pattern}`
        : `Output does not match pattern: ${assertion.pattern}`,
      actual: output,
      expected: assertion.pattern,
    }
  }

  function checkOutputContains(trace: Trace.Complete, assertion: Dataset.Assertion & { type: "output-contains" }): AssertionResult {
    const output = trace.output

    const passed = output.includes(assertion.substring)

    return {
      assertion,
      passed,
      message: passed
        ? `Output contains: "${assertion.substring}"`
        : `Output does not contain: "${assertion.substring}"`,
      actual: output,
      expected: assertion.substring,
    }
  }

  function checkNoErrors(trace: Trace.Complete): AssertionResult {
    const passed = trace.summary.errorCount === 0

    return {
      assertion: { type: "no-errors" },
      passed,
      message: passed ? "No errors" : `Found ${trace.summary.errorCount} error(s)`,
      actual: trace.summary.errorCount,
      expected: 0,
    }
  }

  function checkDurationUnder(trace: Trace.Complete, assertion: Dataset.Assertion & { type: "duration-under" }): AssertionResult {
    const passed = trace.summary.duration <= assertion.milliseconds

    return {
      assertion,
      passed,
      message: passed
        ? `Duration ${trace.summary.duration}ms under ${assertion.milliseconds}ms`
        : `Duration ${trace.summary.duration}ms exceeds ${assertion.milliseconds}ms`,
      actual: trace.summary.duration,
      expected: assertion.milliseconds,
    }
  }

  function checkCostUnder(trace: Trace.Complete, assertion: Dataset.Assertion & { type: "cost-under" }): AssertionResult {
    const passed = trace.summary.cost <= assertion.dollars

    return {
      assertion,
      passed,
      message: passed
        ? `Cost $${trace.summary.cost.toFixed(4)} under $${assertion.dollars}`
        : `Cost $${trace.summary.cost.toFixed(4)} exceeds $${assertion.dollars}`,
      actual: trace.summary.cost,
      expected: assertion.dollars,
    }
  }

  async function checkMetricPasses(trace: Trace.Complete, assertion: Dataset.Assertion & { type: "metric-passes" }): Promise<AssertionResult> {
    const { Metric } = await import("./metric")
    const metric = await Metric.get(assertion.metricID)
    const result = await EvaluationEngine.evaluate(trace, metric)

    return {
      assertion,
      passed: result.passed,
      message: result.passed
        ? `Metric '${metric.name}' passed with score ${result.score}`
        : `Metric '${metric.name}' failed with score ${result.score}`,
      actual: result.score,
      expected: metric.threshold,
    }
  }

  function checkCustom(trace: Trace.Complete, assertion: Dataset.Assertion & { type: "custom" }): AssertionResult {
    try {
      const func = new Function("trace", `return ${assertion.expression}`)
      const result = func(trace)
      const passed = Boolean(result)

      return {
        assertion,
        passed,
        message: passed ? assertion.description : `${assertion.description} (failed)`,
      }
    } catch (error) {
      return {
        assertion,
        passed: false,
        message: `Custom assertion failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Get test run history for a dataset
   */
  export async function getRunHistory(datasetID: string): Promise<RunResult[]> {
    const keys = await Storage.list(["test-run", datasetID])
    const results: RunResult[] = []

    for (const key of keys) {
      const result = await Storage.read<RunResult>(key)
      results.push(result)
    }

    return results.sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Get a specific test run
   */
  export async function getRun(datasetID: string, runID: string): Promise<RunResult> {
    return Storage.read<RunResult>(["test-run", datasetID, runID])
  }
}
