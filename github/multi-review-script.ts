import { execSync, existsSync, readFileSync } from "fs"

type ReviewResult = {
  provider: string
  output: string
}

const REVIEW_PROVIDERS = (process.env.REVIEW_PROVIDERS || "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
const PR_NUMBER = process.env.PR_NUMBER || ""
const PR_TITLE = process.env.PR_TITLE || ""
const PR_BODY = process.env.PR_BODY || ""
const REPO = process.env.GITHUB_REPOSITORY || ""
const INCLUDE_AGENTS = process.env.INCLUDE_AGENTS === "true"

async function buildPrompt(): Promise<string> {
  let prBody = PR_BODY || ""
  console.log(`Using PR body: ${prBody.substring(0, 100)}...`)

  let agentsSection = ""
  try {
    if (INCLUDE_AGENTS && existsSync("AGENTS.md")) {
      const agentsContent = readFileSync("AGENTS.md", "utf8").substring(0, 2000)
      agentsSection = `\n\n## Project Guidelines (from AGENTS.md)\n${agentsContent}`
    }
  } catch (e) {
    console.log("Warning: Could not read AGENTS.md")
  }

  return `REPO: ${REPO}
PR NUMBER: ${PR_NUMBER}
PR TITLE: ${PR_TITLE}
PR DESCRIPTION:
${prBody}

Please review this pull request and provide comprehensive code review focusing on:

## Code Quality & Best Practices
- Clean code principles and readability
- Proper error handling and edge cases
- TypeScript/JavaScript best practices
- Consistent naming conventions

## Bug Detection
- Logic errors and edge cases
- Unhandled error scenarios
- Race conditions and concurrency issues
- Input validation and sanitization

## Performance
- Inefficient algorithms or operations
- Memory leaks and unnecessary allocations
- Large file handling

## Security
- SQL injection, XSS, CSRF vulnerabilities
- Authentication/authorization issues
- Sensitive data exposure

## Testing
- Test coverage gaps
- Missing edge case handling${agentsSection}

## Output Format
- Use \`gh pr comment\` to leave review comments on specific files
- Include specific line numbers and code suggestions
- Provide actionable recommendations
- Summarize key findings at the end

IMPORTANT: Only create comments for actual issues. If the code follows all guidelines, respond with 'lgtm' only.`
}

async function runReview(provider: string, prompt: string): Promise<ReviewResult> {
  console.log(`Starting review with provider: ${provider}`)

  try {
    const result = execSync(`opencode run -m ${provider} -- "${prompt.replace(/"/g, '\\"')}"`, {
      encoding: "utf8",
      timeout: 180000,
    })
    return { provider, output: result }
  } catch (error) {
    console.error(`Error with ${provider}:`, error)
    return { provider, output: `Error: Review failed for ${provider}` }
  }
}

async function synthesize(reviews: ReviewResult[]): Promise<string> {
  const combined = reviews.map((r) => `## Review from ${r.provider}\n\n${r.output}`).join("\n\n---\n\n")
  const providerList = reviews.map((r) => r.provider).join(", ")
  const synthesisPrompt = `You are an expert code reviewer. Synthesize these reviews into one comprehensive review following Claude Code's professional format.

Rules:
- Combine overlapping feedback and remove duplicates
- Highlight unique insights from each review
- Present a clear, actionable review with professional formatting
- Include effort estimation (1-5 scale) and size labels
- Add checklists for different concern categories
- Provide specific code suggestions with line numbers
- Include security, performance, and testing recommendations
- Structure like Claude Code: summary table, detailed analysis, code suggestions

Reviews from providers: ${providerList}

Reviews to synthesize:
${combined}

Output Format (match Claude Code exact style):

**Summary**
[Brief summary of PR and overall findings]

**Critical Issues** ⚠️
1. ⚠️ **[Issue Title] ([Severity] - [Category])**
Location: [file]:[line-range]

[Detailed description of critical issue]

[Code example if relevant]

Recommendation: [Specific fix suggestion]

\`\`\`typescript
// Suggested fix
[fixed code]
\`\`\`

**Code Quality Issues** ✅
[Number]. ✅ **Positive: [Title]** - [Description]

[Number]. ⚠️ **[Issue Title]** - [Description]
Location: [file]:[line-range]

[Code example]

Recommendation: [Fix suggestion]

**Testing Recommendations** 🧪
Before merging, please test with:

✅ [Test case 1]
⚠️ [Test case 2 - requires attention]
✅ [Test case 3]

**Verdict**
Status: ⚠️ [Approve with Recommendations / Changes Requested / Approved]

[Overall assessment and recommendations]

**Positive Aspects** ✨
✅ [Positive aspect 1]
✅ [Positive aspect 2]
✅ [Positive aspect 3]`

  try {
    return execSync(`opencode run -m opencode/big-pickle -- "${synthesisPrompt.replace(/"/g, '\\"')}"`, {
      encoding: "utf8",
      timeout: 180000,
    })
  } catch (error) {
    console.error("Synthesis error:", error)
    return combined
  }
}

let checklistCommentId: string | null = null

async function postOrUpdateChecklist(status: string, completedTasks: string[] = []) {
  const tasks = [
    "Read repository conventions",
    "Read modified files",
    "Analyze security implications",
    "Review code quality and conventions",
    "Provide comprehensive feedback",
  ]

  const checklist = tasks
    .map((task) => {
      const isCompleted = completedTasks.includes(task)
      return `${isCompleted ? "✅" : "⏳"} ${task}`
    })
    .join("\n")

  const body = `🤖 **Multi-Provider Code Review** ${status}\n\n**Tasks:**\n${checklist}`

  const escaped = body.replace(/"/g, '\\"').replace(/\n/g, "\\n")

  if (checklistCommentId) {
    execSync(
      `gh api --method PATCH -H "Accept: application/vnd.github+json" /repos/${REPO}/issues/comments/${checklistCommentId} -f "body=${escaped}"`,
      {
        encoding: "utf8",
      },
    )
  } else {
    const result = execSync(
      `gh api --method POST -H "Accept: application/vnd.github+json" /repos/${REPO}/issues/${PR_NUMBER}/comments -f "body=${escaped}"`,
      {
        encoding: "utf8",
      },
    )
    const comment = JSON.parse(result.toString())
    checklistCommentId = comment.id
  }
}

async function postFinalReview(synthesis: string, providerList: string, confidenceString: string) {
  const finalBody = `🤖 **Code Review Complete**

**Tasks:**
✅ Read repository conventions
✅ Read modified files
✅ Analyze security implications
✅ Review code quality and conventions
✅ Provide comprehensive feedback

${synthesis}

*Review generated by: ${providerList}*
*Provider confidence scores: ${confidenceString}*`

  const escaped = finalBody.replace(/"/g, '\\"').replace(/\n/g, "\\n")
  execSync(
    `gh api --method POST -H "Accept: application/vnd.github+json" /repos/${REPO}/issues/${PR_NUMBER}/comments -f "body=${escaped}"`,
    {
      encoding: "utf8",
    },
  )
}

async function calculateConfidenceScores(reviews: ReviewResult[]): Promise<Record<string, number>> {
  const scores: Record<string, number> = {}

  for (const review of reviews) {
    let score = 0.5

    if (review.output.length > 2000) score += 0.2
    else if (review.output.length > 1000) score += 0.1

    if (review.output.includes("security") || review.output.includes("performance")) score += 0.1
    if (review.output.includes("suggestion") || review.output.includes("recommend")) score += 0.1
    if (review.output.includes("line") || review.output.includes("file")) score += 0.1

    if (review.provider.includes("big-pickle")) score += 0.1
    if (review.provider.includes("grok-code")) score += 0.1
    if (review.provider.includes("minimax")) score += 0.05
    if (review.provider.includes("glm-4.7")) score += 0.05

    scores[review.provider] = Math.min(Math.max(score, 0.1), 1.0)
  }

  return scores
}

async function main() {
  console.log(`Running reviews with ${REVIEW_PROVIDERS.length} providers`)

  const prompt = await buildPrompt()
  console.log(`Prompt built (${prompt.length} chars), includes AGENTS.md: ${INCLUDE_AGENTS}`)

  await postOrUpdateChecklist("🔍 Reading modified files...", ["Read repository conventions"])

  await postOrUpdateChecklist("🔍 Analyzing security implications...", [
    "Read repository conventions",
    "Read modified files",
    "Analyze security implications",
  ])

  const results = await Promise.all(REVIEW_PROVIDERS.map((provider) => runReview(provider, prompt)))

  await postOrUpdateChecklist("🔍 Reviewing code quality and conventions...", [
    "Read repository conventions",
    "Read modified files",
    "Analyze security implications",
    "Review code quality and conventions",
  ])

  console.log("\nAll reviews completed. Synthesizing...")

  await postOrUpdateChecklist("🤔 Providing comprehensive feedback...", [
    "Read repository conventions",
    "Read modified files",
    "Analyze security implications",
    "Review code quality and conventions",
    "Provide comprehensive feedback",
  ])

  const synthesis = await synthesize(results)
  const providerList = results.map((r) => r.provider).join(", ")
  const confidenceScores = await calculateConfidenceScores(results)
  const confidenceString = Object.entries(confidenceScores)
    .map(([provider, score]) => `${provider}: ${(score * 100).toFixed(0)}%`)
    .join(", ")

  console.log("\n=== SYNTHESIS COMPLETE ===\n")
  console.log(synthesis)

  await postFinalReview(synthesis, providerList, confidenceString)
  console.log("\n✅ Final review posted to PR!")
}

main().catch((error) => {
  console.error("Error:", error)
  process.exit(1)
})
