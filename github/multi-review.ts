import { execSync } from "child_process"

type ReviewResult = {
  provider: string
  output: string
}

const REVIEW_PROVIDERS = process.env.REVIEW_PROVIDERS?.split(",").map((p) => p.trim()) || []
const REVIEW_PROMPT = process.env.REVIEW_PROMPT || ""
// ANTHROPIC_API_KEY is optional for testing

if (REVIEW_PROVIDERS.length === 0) {
  console.error("REVIEW_PROVIDERS not set")
  process.exit(1)
}

if (!REVIEW_PROMPT) {
  console.error("REVIEW_PROMPT not set")
  process.exit(1)
}

async function runReview(provider: string): Promise<ReviewResult> {
  console.log(`Starting review with provider: ${provider}`)

  try {
    const result = execSync(`opencode run -m ${provider} -- "${REVIEW_PROMPT}"`, {
      encoding: "utf8",
      timeout: 300000, // 5 minutes timeout
    })
    return {
      provider,
      output: result,
    }
  } catch (error) {
    console.error(`Error running review with ${provider}:`, error)
    return {
      provider,
      output: `Error: Review failed for ${provider}`,
    }
  }
}

async function aggregateReviews(results: ReviewResult[]): Promise<string> {
  const aggregated = results.map((r) => `## Review from ${r.provider}\n\n${r.output}`).join("\n\n---\n\n")

  const synthesisPrompt = `You are an expert code reviewer. Please synthesize the following reviews from multiple AI models into a single, comprehensive code review.

Rules:
- Combine overlapping feedback
- Highlight unique insights from each review
- Remove duplicates
- Present a clear, actionable review
- Maintain the tone and suggestions from the reviews
- If all reviews agree on something, state that clearly
- Keep the synthesized review concise and actionable
- Include all the specific code violations found by any reviewer

Here are the reviews to synthesize:

${aggregated}

Please provide the synthesized review:`

  try {
    const synthesisResult = execSync(`opencode run -m opencode/big-pickle -- "${synthesisPrompt}"`, {
      encoding: "utf8",
      timeout: 300000, // 5 minutes timeout
    })
    return synthesisResult
  } catch (error) {
    console.error("Error synthesizing reviews:", error)
    return aggregated
  }
}

async function main() {
  console.log(`Running reviews with ${REVIEW_PROVIDERS.length} providers: ${REVIEW_PROVIDERS.join(", ")}`)
  console.log(`Prompt length: ${REVIEW_PROMPT.length} characters`)

  const results = await Promise.all(REVIEW_PROVIDERS.map((provider) => runReview(provider)))

  console.log("\nAll reviews completed. Aggregating...")

  const synthesis = await aggregateReviews(results)

  console.log("\n=== SYNTHESIZED REVIEW ===\n")
  console.log(synthesis)

  process.stdout.write(synthesis)
}

main().catch((error) => {
  console.error("Error:", error)
  process.exit(1)
})
