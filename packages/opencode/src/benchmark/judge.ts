import { BenchmarkMetrics } from "./metrics"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"

/**
 * LLM-based judge for evaluating compaction quality.
 * Compares the output summaries from hybrid and legacy compaction
 * to determine which one better preserves important context.
 */
export namespace CompactionJudge {
  const log = Log.create({ service: "benchmark.judge" })

  export interface JudgmentResult {
    winner: "hybrid" | "legacy" | "tie"
    rationale: string
    scores: {
      hybrid: {
        file_preservation: number
        error_tracking: number
        intent_clarity: number
        task_tracking: number
        technical_accuracy: number
        overall: number
      }
      legacy: {
        file_preservation: number
        error_tracking: number
        intent_clarity: number
        task_tracking: number
        technical_accuracy: number
        overall: number
      }
    }
  }

  const JUDGE_PROMPT = `You are an expert evaluator for coding assistant context compaction.

Your task is to compare two compaction summaries from the same coding session and determine which one better preserves critical information for continuing the conversation.

## Evaluation Criteria (score each 1-10):

1. **File Preservation**: How well does the summary preserve:
   - File paths that were read, modified, or created
   - The relationship between files
   - Change summaries for modifications

2. **Error Tracking**: How well does the summary capture:
   - Errors that occurred during the session
   - Whether errors were resolved
   - Error context and stack traces

3. **Intent Clarity**: How clearly does the summary convey:
   - What the user was trying to accomplish
   - The overall goal of the session
   - Current state of progress

4. **Task Tracking**: How well does the summary track:
   - Pending tasks that still need completion
   - Completed tasks and their outcomes
   - Dependencies between tasks

5. **Technical Accuracy**: How accurate and useful are:
   - Technical decisions made during the session
   - Key code patterns or approaches used
   - Important constraints or requirements discovered

## Output Format

Return a JSON object with the following structure:
{
  "winner": "A" | "B" | "tie",
  "rationale": "1-2 sentences explaining the decision",
  "scores": {
    "A": {
      "file_preservation": <1-10>,
      "error_tracking": <1-10>,
      "intent_clarity": <1-10>,
      "task_tracking": <1-10>,
      "technical_accuracy": <1-10>,
      "overall": <1-10>
    },
    "B": {
      "file_preservation": <1-10>,
      "error_tracking": <1-10>,
      "intent_clarity": <1-10>,
      "task_tracking": <1-10>,
      "technical_accuracy": <1-10>,
      "overall": <1-10>
    }
  }
}

Return ONLY the JSON object, no additional text.`

  /**
   * Evaluate two compaction summaries and determine which is better
   */
  export async function evaluate(
    hybridOutput: string,
    legacyOutput: string,
    model: string,
  ): Promise<JudgmentResult> {
    log.info("evaluating compaction quality", { model })

    const userPrompt = `## Summary A (Hybrid Compaction):
\`\`\`
${hybridOutput}
\`\`\`

## Summary B (Legacy Compaction):
\`\`\`
${legacyOutput}
\`\`\`

Evaluate these summaries based on the criteria above and return your judgment as JSON.`

    try {
      // Parse model
      const modelParts = Provider.parseModel(model)
      const providerModel = await Provider.getModel(modelParts.providerID, modelParts.modelID)

      // Get the AI SDK model
      const aiModel = Provider.model(providerModel)

      // Use generateText from AI SDK
      const { generateText } = await import("ai")
      const response = await generateText({
        model: aiModel,
        system: JUDGE_PROMPT,
        prompt: userPrompt,
        temperature: 0.1, // Low temperature for consistent evaluation
      })

      // Parse response
      const result = parseJudgmentResponse(response.text)

      log.info("judgment complete", {
        winner: result.winner,
        hybridScore: result.scores.hybrid.overall,
        legacyScore: result.scores.legacy.overall,
      })

      return result
    } catch (error) {
      log.error("judgment failed", { error: error instanceof Error ? error.message : error })

      // Return a tie if evaluation fails
      return {
        winner: "tie",
        rationale: "Evaluation failed: " + (error instanceof Error ? error.message : "Unknown error"),
        scores: {
          hybrid: createDefaultScores(),
          legacy: createDefaultScores(),
        },
      }
    }
  }

  /**
   * Parse the LLM response into a structured judgment
   */
  function parseJudgmentResponse(responseText: string): JudgmentResult {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response")
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Map winner from A/B to hybrid/legacy
    const winnerMap: Record<string, "hybrid" | "legacy" | "tie"> = {
      A: "hybrid",
      B: "legacy",
      tie: "tie",
    }

    return {
      winner: winnerMap[parsed.winner] || "tie",
      rationale: parsed.rationale || "No rationale provided",
      scores: {
        hybrid: mapScores(parsed.scores?.A),
        legacy: mapScores(parsed.scores?.B),
      },
    }
  }

  /**
   * Map raw scores to typed scores with defaults
   */
  function mapScores(rawScores: Record<string, number> | undefined): JudgmentResult["scores"]["hybrid"] {
    if (!rawScores) {
      return createDefaultScores()
    }

    return {
      file_preservation: rawScores.file_preservation ?? 5,
      error_tracking: rawScores.error_tracking ?? 5,
      intent_clarity: rawScores.intent_clarity ?? 5,
      task_tracking: rawScores.task_tracking ?? 5,
      technical_accuracy: rawScores.technical_accuracy ?? 5,
      overall: rawScores.overall ?? 5,
    }
  }

  /**
   * Create default scores for error cases
   */
  function createDefaultScores(): JudgmentResult["scores"]["hybrid"] {
    return {
      file_preservation: 5,
      error_tracking: 5,
      intent_clarity: 5,
      task_tracking: 5,
      technical_accuracy: 5,
      overall: 5,
    }
  }

  /**
   * Update benchmark results with judge evaluation
   */
  export async function judgeAndUpdate(
    result: BenchmarkMetrics.BenchmarkResult,
    model: string,
  ): Promise<BenchmarkMetrics.BenchmarkResult> {
    // Get the latest compaction outputs from each method
    const hybridOutput = result.hybrid.compactions.length > 0
      ? result.hybrid.compactions[result.hybrid.compactions.length - 1].output_text
      : ""

    const legacyOutput = result.legacy.compactions.length > 0
      ? result.legacy.compactions[result.legacy.compactions.length - 1].output_text
      : ""

    if (!hybridOutput || !legacyOutput) {
      log.warn("cannot judge - missing compaction outputs")
      return result
    }

    const judgment = await evaluate(hybridOutput, legacyOutput, model)

    return {
      ...result,
      llm_judgment: {
        winner: judgment.winner,
        rationale: judgment.rationale,
        judged_at: Date.now(),
      },
    }
  }
}
