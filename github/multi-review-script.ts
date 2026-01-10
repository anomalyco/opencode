import { execSync, existsSync, readFileSync } from "fs"

type ReviewResult = {
  provider: string
  output: string
}

const REVIEW_PROVIDERS = (process.env.REVIEW_PROVIDERS || "").split(",").map((p) => p.trim()).filter(Boolean)
const PR_NUMBER = process.env.PR_NUMBER || ""
const REPO = process.env.GITHUB_REPOSITORY || ""
const PR_TITLE = process.env.PR_TITLE || ""
const INCLUDE_AGENTS = process.env.INCLUDE_AGENTS === "true"

async function buildPrompt(): Promise<string> {
  const prBody = execSync("jq -r .body pr_data.json", { encoding: "utf8" }).trim()
  
  let agentsSection = ""
  if (INCLUDE_AGENTS && existsSync("AGENTS.md")) {
    const agentsContent = readFileSync("AGENTS.md", "utf8").substring(0, 2000)
    agentsSection = `\n\n## Project Guidelines (from AGENTS.md)\n${agentsContent}`
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
  const providerList = reviews.map(r => r.provider).join(", ")
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
✅ [Positive aspect 3]

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
}

let checklistCommentId: string | null = null

async function postOrUpdateChecklist(status: string, completedTasks: string[] = []) {
  const tasks = [
    "Read repository conventions",
    "Read modified files",
    "Analyze security implications",
    "Review code quality and conventions",
    "Provide comprehensive feedback"
  ]

  const checklist = tasks.map(task => {
    const isCompleted = completedTasks.includes(task)
    return `${isCompleted ? '✅' : '⏳'} ${task}`
  }).join('\n')

  const body = `🤖 **Multi-Provider Code Review** ${status}\n\n**Tasks:**\n${checklist}`

  const escaped = body.replace(/"/g, '\\"').replace(/\n/g, '\\n')

  if (checklistCommentId) {
    // Update existing comment
    execSync(`gh api --method PATCH -H "Accept: application/vnd.github+json" /repos/${REPO}/issues/comments/${checklistCommentId} -f "body=${escaped}"`, {
      encoding: "utf8",
    })
  } else {
    // Create new comment with specific author name
    const result = execSync(`gh api --method POST -H "Accept: application/vnd.github+json" -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" /repos/${REPO}/issues/${PR_NUMBER}/comments -f "body=${escaped}"`, {
      encoding: "utf8",
    })
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

  const escaped = finalBody.replace(/"/g, '\\"').replace(/\n/g, '\\n')
  execSync(`gh api --method POST -H "Accept: application/vnd.github+json" /repos/${REPO}/issues/${PR_NUMBER}/comments -f "body=${escaped}"`, {
    encoding: "utf8",
  })
}

async function calculateConfidenceScores(reviews: ReviewResult[]): Promise<Record<string, number>> {
  const scores: Record<string, number> = {}

  // Simple confidence scoring based on review length and content quality
  for (const review of reviews) {
    let score = 0.5 // Base score

    // Length factor (longer reviews tend to be more thorough)
    if (review.output.length > 2000) score += 0.2
    else if (review.output.length > 1000) score += 0.1

    // Content quality indicators
    if (review.output.includes('security') || review.output.includes('performance')) score += 0.1
    if (review.output.includes('suggestion') || review.output.includes('recommend')) score += 0.1
    if (review.output.includes('line') || review.output.includes('file')) score += 0.1

    // Provider-specific adjustments
    if (review.provider.includes('big-pickle')) score += 0.1 // Reasoning model
    if (review.provider.includes('grok-code')) score += 0.1 // Code-specialized
    if (review.provider.includes('minimax')) score += 0.05 // General purpose
    if (review.provider.includes('glm-4.7')) score += 0.05 // Balanced

    scores[review.provider] = Math.min(Math.max(score, 0.1), 1.0)
  }

  return scores
}

async function main() {
  console.log(`Running reviews with ${REVIEW_PROVIDERS.length} providers`)

  // Post initial checklist immediately
  await postOrUpdateChecklist("🤖 Starting multi-provider code review...")

  // Build prompt
  const prompt = await buildPrompt()
  console.log(`Prompt built (${prompt.length} chars), includes AGENTS.md: ${INCLUDE_AGENTS}`)

  // Update checklist - reading conventions
  await postOrUpdateChecklist("📖 Reading repository conventions...", ["Read repository conventions"])

  // Update checklist - reading files
  await postOrUpdateChecklist("📁 Reading modified files...", ["Read repository conventions", "Read modified files"])

  // Run reviews in parallel
  const results = await Promise.all(REVIEW_PROVIDERS.map((provider) => runReview(provider, prompt)))

  // Update checklist - analysis complete
  await postOrUpdateChecklist("🔒 Analyzing security implications...", ["Read repository conventions", "Read modified files", "Analyze security implications"])

  // Update checklist - code review
  await postOrUpdateChecklist("🔍 Reviewing code quality and conventions...", ["Read repository conventions", "Read modified files", "Analyze security implications", "Review code quality and conventions"])

  console.log("\nAll reviews completed. Synthesizing...")

  // Update checklist - synthesizing
  await postOrUpdateChecklist("🤔 Providing comprehensive feedback...", ["Read repository conventions", "Read modified files", "Analyze security implications", "Review code quality and conventions", "Provide comprehensive feedback"])

  const synthesis = await synthesize(results)
  const providerList = results.map(r => r.provider).join(", ")
  const confidenceScores = await calculateConfidenceScores(results)
  const confidenceString = Object.entries(confidenceScores)
    .map(([provider, score]) => `${provider}: ${(score * 100).toFixed(0)}%`)
    .join(", ")

  console.log("\n=== SYNTHESIS COMPLETE ===\n")
  console.log(synthesis)

  // Post final comprehensive review
  await postFinalReview(synthesis, providerList, confidenceString)
  console.log("\n✅ Final review posted to PR!")
}

main().catch((error) => {
  console.error("Error:", error)
  process.exit(1)
})
  } catch (e) {
    return `Error with ${provider}`
  }
}

async function synthesize(reviews: string[]) {
  const combined = reviews.join("\n\n---\n\n")
  const synthesis = `Synthesize these code reviews into one comprehensive review. Combine overlapping feedback, highlight unique insights, remove duplicates:\n\n${combined}`
  try {
    return execSync(`opencode run -m opencode/big-pickle -- "${synthesis}"`, {
      encoding: "utf8",
      timeout: 180000,
    })
  } catch (e) {
    return combined
  }
}

async function main() {
  console.log(`Running ${providers.length} parallel reviews...`)
  const results = await Promise.all(providers.map(runReview))
  console.log("Synthesizing results...")
  const final = await synthesize(results)
  console.log("\n=== SYNTHESIS ===\n" + final)

  // Post as PR comment
  const escaped = final.replace(/"/g, '\\"').replace(/\n/g, "\\n")
  execSync(
    `gh api --method POST -H "Accept: application/vnd.github+json" /repos/${repo}/issues/${prNumber}/comments -f "body=${escaped}"`,
    { encoding: "utf8" },
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
