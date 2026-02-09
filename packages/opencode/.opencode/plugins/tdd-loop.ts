/**
 * TDD-Loop Plugin for OpenCode
 * Implements Test-Driven Development with AI through an iterative loop:
 *
 * User Prompt → Generate E2E Test Plan → Generate Tests → Implement Code → Review → Run Tests → [Loop until pass]
 *
 * Usage:
 *   tdd-loop "Build user authentication with JWT" --max 15
 *   tdd-loop "Add shopping cart feature" --max 10 --test-command "bun test"
 *
 * Phases:
 *   1. PLAN      - Generate E2E test plan from user prompt
 *   2. TEST_GEN  - Generate actual .e2e.ts test files
 *   3. IMPLEMENT - Implement the feature/code
 *   4. REVIEW    - Thorough code review (strict)
 *   5. TEST_RUN  - Execute tests, capture output
 *   6. FIX       - Fix issues from review/test failures (loops back to REVIEW)
 */

import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"

// State file path
const STATE_DIR = join(homedir(), ".config", "opencode", "state")
const STATE_FILE = join(STATE_DIR, "tdd-loop.json")

// Phase definitions
type TDDPhase = "plan" | "test_gen" | "implement" | "review" | "test_run" | "fix"

type TDDStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "max_reached"
  | "approved"
  | "max_reviews_reached"
  | "tests_passing"

type TDDState = {
  active: boolean
  prompt: string
  phase: TDDPhase
  iterations: number
  max: number
  testCommand: string | null
  testPlan: string
  lastTestOutput: string
  lastReviewFeedback: string
  reviewCount: number
  maxReviews: number
  status: TDDStatus
  testResults: {
    passed: number
    failed: number
    total: number
  }
  stateFile: string
  startedAt: string
  lastUpdatedAt: string
}

// Promise tokens for each phase
const PROMISES = {
  plan: "PLAN_DONE",
  test_gen: "TESTS_WRITTEN",
  implement: "DONE",
  review: {
    approved: "APPROVED",
    needfix: "NEEDFIX",
  },
  fix: "DONE",
}

// Global state
const state: Record<string, TDDState> = {}
let activeSession: string | null = null

// ============================================================================
// Utility Functions
// ============================================================================

function ensureDir(path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch {
    // Ignore
  }
}

function cleanupStateFile(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Ignore
  }
}

function writeStateFile(sessionID: string, s: TDDState): void {
  if (!s.stateFile) return
  try {
    ensureDir(s.stateFile)
    const data = {
      sessionID,
      active: s.active,
      prompt: s.prompt,
      phase: s.phase,
      iterations: s.iterations,
      max: s.max,
      testCommand: s.testCommand,
      testResults: s.testResults,
      reviewCount: s.reviewCount,
      maxReviews: s.maxReviews,
      status: s.status,
      startedAt: s.startedAt,
      lastUpdatedAt: new Date().toISOString(),
    }
    writeFileSync(s.stateFile, JSON.stringify(data, null, 2))
  } catch {
    // Silently ignore
  }
}

function writeFinalState(sessionID: string, s: TDDState): void {
  s.lastUpdatedAt = new Date().toISOString()
  writeStateFile(sessionID, s)
}

/**
 * Tokenize a string respecting quoted strings
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (char === "\\" && i + 1 < input.length) {
      const next = input[i + 1]
      if (next === '"' || next === "'" || next === "\\") {
        current += next
        i++
        continue
      }
    }

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      inQuote = char
    } else if (char === " " || char === "\t") {
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }

  if (current) tokens.push(current)
  return tokens
}

/**
 * Parse command arguments
 */
function parseArgs(args: string): {
  prompt: string
  max: number
  testCommand: string | null
} {
  let input = args.trim()

  // Handle CLI double-quoting
  if (input.startsWith('"') && input.endsWith('"') && input.length > 2) {
    const inner = input.slice(1, -1)
    if (inner.includes('\\"')) {
      input = inner.replace(/\\"/g, '"')
    }
  }

  const tokens = tokenize(input)
  const promptParts: string[] = []
  let max = 15
  let testCommand: string | null = null

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === "--max" || token === "--max-iterations") {
      max = parseInt(tokens[++i] || "15", 10)
    } else if (token === "--test-command" || token === "--test") {
      testCommand = tokens[++i] || null
    } else {
      promptParts.push(token)
    }
    i++
  }

  return {
    prompt: promptParts.join(" ") || "Implement the requested feature",
    max,
    testCommand,
  }
}

/**
 * Check for completion promise in text
 */
function checkPromise(text: string | undefined, expected: string): boolean {
  if (!text || !expected) return false
  const regex = /<promise>([\s\S]*?)<\/promise>/gi
  const matches = text.matchAll(regex)
  for (const match of matches) {
    if (match[1].trim() === expected) return true
  }
  return false
}

/**
 * Auto-detect test command from project
 */
async function detectTestCommand($: any): Promise<string> {
  try {
    // Check package.json scripts
    const pkgPath = "package.json"
    const pkgExists = existsSync(pkgPath)
    if (pkgExists) {
      const pkg = JSON.parse(await Bun.file(pkgPath).text())
      const scripts = pkg.scripts || {}

      // Priority order for test scripts
      if (scripts["test:e2e"]) return "bun run test:e2e"
      if (scripts["e2e"]) return "bun run e2e"
      if (scripts["test:integration"]) return "bun run test:integration"
    }

    // Check for framework configs
    if (existsSync("playwright.config.ts") || existsSync("playwright.config.js")) {
      return "npx playwright test"
    }
    if (existsSync("vitest.config.ts") || existsSync("vitest.config.js")) {
      return "bun run vitest run tests/**/*.e2e.ts"
    }
    if (existsSync("jest.config.ts") || existsSync("jest.config.js")) {
      return "npx jest tests/**/*.e2e.ts"
    }

    // Default to bun test
    return "bun test tests/**/*.e2e.ts"
  } catch {
    return "bun test tests/**/*.e2e.ts"
  }
}

/**
 * Parse test output for results
 */
function parseTestResults(output: string): { passed: number; failed: number; total: number } {
  // Try common test output patterns
  let passed = 0
  let failed = 0

  // Bun test format: "X pass, Y fail"
  const bunMatch = output.match(/(\d+)\s+pass.*?(\d+)\s+fail/i)
  if (bunMatch) {
    passed = parseInt(bunMatch[1], 10)
    failed = parseInt(bunMatch[2], 10)
    return { passed, failed, total: passed + failed }
  }

  // Vitest format: "X passed, Y failed"
  const vitestMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed/i)
  if (vitestMatch) {
    passed = parseInt(vitestMatch[1], 10)
    failed = parseInt(vitestMatch[2], 10)
    return { passed, failed, total: passed + failed }
  }

  // Jest format: "Tests: X passed, Y failed"
  const jestMatch = output.match(/Tests:.*?(\d+)\s+passed.*?(\d+)\s+failed/i)
  if (jestMatch) {
    passed = parseInt(jestMatch[1], 10)
    failed = parseInt(jestMatch[2], 10)
    return { passed, failed, total: passed + failed }
  }

  // Check for any failure indicators
  if (output.includes("FAIL") || output.includes("failed") || output.includes("error")) {
    return { passed: 0, failed: 1, total: 1 }
  }

  // Check for success indicators
  if (output.includes("PASS") || output.includes("passed") || output.includes("success")) {
    return { passed: 1, failed: 0, total: 1 }
  }

  return { passed: 0, failed: 0, total: 0 }
}

// ============================================================================
// System Prompts for Each Phase
// ============================================================================

const PLAN_SYSTEM_PROMPT = `
<tdd-plan-mode>
## E2E Test Planning Mode

You are in TEST PLANNING mode. Your job is to analyze the user's request and create a comprehensive E2E test plan.

### Instructions:
1. Understand the feature/functionality being requested
2. Identify ALL user-facing behaviors that need testing
3. Categorize tests by priority

### Output Format:
\`\`\`markdown
## E2E Test Plan for: <feature name>

### CRITICAL Tests (Must Pass)
- [ ] Test 1: <description> - <what it verifies>
- [ ] Test 2: <description> - <what it verifies>

### HIGH Priority Tests (Important User Flows)
- [ ] Test 3: <description> - <what it verifies>
- [ ] Test 4: <description> - <what it verifies>

### MEDIUM Priority Tests (Edge Cases)
- [ ] Test 5: <description> - <what it verifies>

### Test Environment Requirements
- Dependencies needed
- Setup/teardown requirements
- Mock requirements
\`\`\`

### Completion:
When the test plan is complete, respond with:
<promise>PLAN_DONE</promise>
</tdd-plan-mode>
`

const TEST_GEN_SYSTEM_PROMPT = `
<tdd-test-gen-mode>
## Test Generation Mode

You are in TEST GENERATION mode. Your job is to create actual runnable E2E test files.

### Instructions:
1. Create test files in the \`tests/\` directory with \`.e2e.ts\` extension
2. Use the appropriate test framework (auto-detected or bun:test by default)
3. Implement ALL CRITICAL and HIGH priority tests from the plan
4. Include proper setup/teardown

### Test File Structure:
\`\`\`typescript
// tests/<feature>.e2e.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test"

describe("<Feature> E2E Tests", () => {
  beforeAll(async () => {
    // Setup
  })

  afterAll(async () => {
    // Cleanup
  })

  describe("CRITICAL: <category>", () => {
    it("should <behavior>", async () => {
      // Test implementation
    })
  })

  describe("HIGH: <category>", () => {
    it("should <behavior>", async () => {
      // Test implementation
    })
  })
})
\`\`\`

### Important:
- Tests should initially FAIL (we haven't implemented the feature yet)
- Tests should verify actual user-facing behavior
- Use descriptive test names
- Create the \`tests/\` directory if it doesn't exist

### Completion:
When all test files are written, respond with:
<promise>TESTS_WRITTEN</promise>
</tdd-test-gen-mode>
`

const IMPLEMENT_SYSTEM_PROMPT = `
<tdd-implement-mode>
## Implementation Mode

You are in IMPLEMENTATION mode. Your job is to write the production code that makes the tests pass.

### TDD Process:
1. Read the E2E test files to understand requirements
2. Implement the feature step by step
3. The tests define the expected behavior - make them pass

### Guidelines:
- Focus on making tests pass
- Write clean, maintainable code
- Handle error cases properly
- Follow the project's coding conventions

### Completion:
When the implementation is complete, respond with:
<promise>DONE</promise>

Note: You don't need to run tests yet - that happens automatically in the next phase.
</tdd-implement-mode>
`

const REVIEW_SYSTEM_PROMPT = `
<tdd-review-mode>
## Code Review Mode (STRICT/THOROUGH)

You are in CODE REVIEW mode. Be EXTREMELY THOROUGH and CRITICAL.

### Review Philosophy:
- Assume there ARE issues until proven otherwise
- Question every design decision
- Look for what's missing, not just what's wrong
- A good review finds problems; an excellent review prevents future ones

### 1. Retrieve and Inspect Changes
- Run \`git diff HEAD --stat\` to see which files changed
- Run \`git diff HEAD\` to inspect specific changes
- Run \`git status\` to see untracked files
- Read full files if needed for context

### 2. Security Analysis (CRITICAL)
- Injection vulnerabilities (SQL, XSS, command injection)
- Authentication/authorization issues
- Data exposure risks
- Input validation gaps
- Secrets or credentials in code

### 3. Performance Review
- N+1 queries, memory leaks, blocking operations
- Inefficient algorithms
- Missing caching opportunities
- Resource cleanup

### 4. Spec Compliance
- Every requirement from the original spec addressed?
- Edge cases handled?
- Error scenarios covered?
- Requirements misunderstood?

### 5. Code Quality
- Design patterns appropriate?
- Maintainability concerns?
- Code smells or anti-patterns?
- Proper error handling?

### 6. Test Coverage Verification
- Check that E2E test files exist in \`tests/*.e2e.ts\`
- Verify ALL CRITICAL tests are present
- Verify HIGH priority tests are present
- Tests actually verify the right behavior?

### Required Response:
After thorough review, respond with ONE of:
- <promise>APPROVED</promise> - Code meets ALL requirements, is secure, performant, and well-tested
- <promise>NEEDFIX</promise> - Issues found that must be addressed

If responding with NEEDFIX, list EVERY issue with priority:
- **CRITICAL**: Bugs, security issues, data loss risks, missing tests
- **HIGH**: Design flaws, performance issues, inadequate coverage
- **MEDIUM**: Code quality, style issues
</tdd-review-mode>
`

const FIX_SYSTEM_PROMPT = `
<tdd-fix-mode>
## Fix Mode

You are addressing issues identified during review and/or test failures.

### Your Responsibilities:
1. Fix ALL CRITICAL issues first
2. Fix HIGH priority issues
3. Address MEDIUM priority issues if time permits
4. Ensure tests pass after fixes

### If Review Feedback Provided:
Address each point from the review systematically.

### If Test Failures Provided:
1. Read the test output carefully
2. Understand why each test failed
3. Fix the code to make tests pass
4. Do NOT modify tests to make them pass (unless tests are incorrect)

### Completion:
When all fixes are complete, respond with:
<promise>DONE</promise>

This will trigger a re-review of the changes.
</tdd-fix-mode>
`

const TEST_RUN_SYSTEM_PROMPT = `
<tdd-test-run-mode>
## Test Execution Mode

The tests are being executed automatically. Wait for results.

If tests pass: The loop completes successfully.
If tests fail: You'll enter FIX mode to address failures.
</tdd-test-run-mode>
`

// ============================================================================
// User Prompt Builders
// ============================================================================

function buildPlanUserPrompt(s: TDDState): string {
  return `## Create E2E Test Plan

Please create a comprehensive E2E test plan for the following requirement:

### User Request:
\`\`\`
${s.prompt}
\`\`\`

### Instructions:
1. Analyze the requirement thoroughly
2. Identify all testable user behaviors
3. Categorize by priority (CRITICAL, HIGH, MEDIUM)
4. Consider edge cases and error scenarios

When complete, respond with: <promise>PLAN_DONE</promise>`
}

function buildTestGenUserPrompt(s: TDDState): string {
  return `## Generate E2E Test Files

Based on the test plan, create actual runnable test files.

### Original Request:
\`\`\`
${s.prompt}
\`\`\`

### Test Plan:
${s.testPlan || "(Test plan from previous step)"}

### Instructions:
1. Create test files in \`tests/\` directory with \`.e2e.ts\` extension
2. Implement ALL CRITICAL and HIGH priority tests
3. Use bun:test or the project's test framework
4. Tests should be runnable but will fail (no implementation yet)

When all test files are written, respond with: <promise>TESTS_WRITTEN</promise>`
}

function buildImplementUserPrompt(s: TDDState): string {
  return `## Implement Feature

Now implement the feature to make the E2E tests pass.

### Original Request:
\`\`\`
${s.prompt}
\`\`\`

### Instructions:
1. Read the test files in \`tests/*.e2e.ts\` to understand requirements
2. Implement the production code
3. Follow TDD: make the red tests go green

When implementation is complete, respond with: <promise>DONE</promise>`
}

function buildReviewUserPrompt(s: TDDState): string {
  return `## Code Review Request

The implementation is complete. Please perform a thorough code review.

### Original Request:
\`\`\`
${s.prompt}
\`\`\`

### Review Instructions:
1. Run \`git diff HEAD --stat\` and \`git diff HEAD\` to see changes
2. Run \`git status\` to see untracked files
3. Check security, performance, spec compliance
4. Verify E2E tests exist and are comprehensive

### Required Response:
- <promise>APPROVED</promise> if code is production-ready
- <promise>NEEDFIX</promise> if issues need addressing (list all issues)`
}

function buildReReviewUserPrompt(s: TDDState): string {
  return `## Re-Review Request (Review #${s.reviewCount + 1})

Previous issues have been addressed. Please verify the fixes.

### Original Request:
\`\`\`
${s.prompt}
\`\`\`

### Instructions:
1. Verify all previous issues are resolved
2. Check for any new issues introduced
3. Ensure tests are still comprehensive

### Required Response:
- <promise>APPROVED</promise> if all issues resolved
- <promise>NEEDFIX</promise> if more work needed`
}

function buildFixUserPrompt(s: TDDState): string {
  let prompt = `## Fix Issues

Please address the following issues:\n\n`

  if (s.lastReviewFeedback) {
    prompt += `### Review Feedback:\n${s.lastReviewFeedback}\n\n`
  }

  if (s.lastTestOutput && s.testResults.failed > 0) {
    prompt += `### Test Failures (${s.testResults.failed} failed):
\`\`\`
${s.lastTestOutput}
\`\`\`\n\n`
  }

  prompt += `### Original Request:
\`\`\`
${s.prompt}
\`\`\`

### Instructions:
1. Address all CRITICAL and HIGH priority issues
2. Fix failing tests by fixing the code (not the tests)
3. Ensure code quality standards are met

When all fixes are complete, respond with: <promise>DONE</promise>`

  return prompt
}

function buildTestRunUserPrompt(
  s: TDDState,
  testOutput: string,
  results: { passed: number; failed: number; total: number },
): string {
  if (results.failed === 0 && results.total > 0) {
    return `## Test Results: ALL PASSED ✓

\`\`\`
${testOutput}
\`\`\`

All ${results.total} tests passed. The TDD loop is complete!`
  }

  return `## Test Results: ${results.failed} FAILED

\`\`\`
${testOutput}
\`\`\`

${results.failed} test(s) failed. Entering FIX mode to address failures.`
}

// ============================================================================
// Main Plugin Export
// ============================================================================

async function tddLoop(input: {
  client: any
  project: string
  worktree: string
  directory: string
  serverUrl: string
  $: any
}) {
  const { $ } = input

  return {
    // ========================================================================
    // Commands
    // ========================================================================
    command: {
      "tdd-loop": {
        description:
          "Start a TDD loop: test plan → generate tests → implement → review → run tests. Usage: tdd-loop <prompt> --max <n>",
        template: `You are starting a Test-Driven Development loop.

The user wants you to build the following feature using TDD:
$ARGUMENTS

This is an iterative process:
1. First, create a comprehensive E2E test plan
2. Then generate actual test files
3. Implement the code to make tests pass
4. Review the code thoroughly
5. Run tests and fix any failures
6. Loop until all tests pass

Begin by creating the E2E test plan now.`,
      },
    },

    // ========================================================================
    // Tools
    // ========================================================================
    tool: {
      "tdd-status": {
        description: "Get the current TDD loop status",
        args: {},
        async execute(_args: {}, ctx: any) {
          const s = state[ctx.sessionID]
          if (!s?.active) {
            return "No active TDD loop"
          }
          return JSON.stringify(
            {
              active: s.active,
              phase: s.phase,
              prompt: s.prompt.slice(0, 100) + (s.prompt.length > 100 ? "..." : ""),
              iterations: s.iterations,
              max: s.max,
              testCommand: s.testCommand,
              testResults: s.testResults,
              reviewCount: s.reviewCount,
              maxReviews: s.maxReviews,
              status: s.status,
              startedAt: s.startedAt,
            },
            null,
            2,
          )
        },
      },
      "cancel-tdd": {
        description: "Cancel the active TDD loop",
        args: {},
        async execute(_args: {}, ctx: any) {
          const s = state[ctx.sessionID]
          if (s) {
            s.status = "cancelled"
            s.active = false
            writeFinalState(ctx.sessionID, s)
            delete state[ctx.sessionID]
            if (activeSession === ctx.sessionID) {
              activeSession = null
            }
            return "TDD loop cancelled"
          }
          return "No active TDD loop to cancel"
        },
      },
    },

    // ========================================================================
    // Event Hook - Initialize on command execution
    // ========================================================================
    async ["event"](hookInput: { event: any }): Promise<void> {
      const event = hookInput.event
      if (event?.type === "command.executed" && event?.properties?.name === "tdd-loop") {
        const sessionID = event.properties.sessionID
        const args = parseArgs(event.properties.arguments || "")
        const now = new Date().toISOString()

        // Detect test command if not provided
        const testCommand = args.testCommand || (await detectTestCommand($))

        // Clean up existing state file
        cleanupStateFile(STATE_FILE)

        state[sessionID] = {
          active: true,
          prompt: args.prompt,
          phase: "plan",
          iterations: 0,
          max: args.max,
          testCommand,
          testPlan: "",
          lastTestOutput: "",
          lastReviewFeedback: "",
          reviewCount: 0,
          maxReviews: 5,
          status: "running",
          testResults: { passed: 0, failed: 0, total: 0 },
          stateFile: STATE_FILE,
          startedAt: now,
          lastUpdatedAt: now,
        }

        activeSession = sessionID
        writeStateFile(sessionID, state[sessionID])
      }
    },

    // ========================================================================
    // Session Stop Hook - Phase transitions and loop control
    // ========================================================================
    async ["session.stop"](
      hookInput: { sessionID: string; step: number; lastAssistantText?: string },
      output: { stop: boolean; prompt?: string; systemMessage?: string },
    ): Promise<void> {
      const s = state[hookInput.sessionID]
      if (!s?.active) return

      s.iterations++
      s.lastUpdatedAt = new Date().toISOString()

      const text = hookInput.lastAssistantText || ""

      // ======================================================================
      // PHASE: PLAN
      // ======================================================================
      if (s.phase === "plan") {
        if (checkPromise(text, PROMISES.plan)) {
          // Save test plan and transition to TEST_GEN
          s.testPlan = text
          s.phase = "test_gen"

          output.stop = false
          output.systemMessage = "[TDD - TEST GENERATION]"
          output.prompt = buildTestGenUserPrompt(s)
          writeStateFile(hookInput.sessionID, s)
          return
        }

        // Check max iterations
        if (s.iterations >= s.max) {
          s.status = "max_reached"
          s.active = false
          activeSession = null
          writeFinalState(hookInput.sessionID, s)
          delete state[hookInput.sessionID]
          output.stop = true
          return
        }

        // Continue planning
        output.stop = false
        output.systemMessage = `[TDD - PLANNING (${s.iterations}/${s.max})]`
        output.prompt = "Continue creating the test plan. When complete: <promise>PLAN_DONE</promise>"
        writeStateFile(hookInput.sessionID, s)
        return
      }

      // ======================================================================
      // PHASE: TEST_GEN
      // ======================================================================
      if (s.phase === "test_gen") {
        if (checkPromise(text, PROMISES.test_gen)) {
          // Transition to IMPLEMENT
          s.phase = "implement"

          output.stop = false
          output.systemMessage = "[TDD - IMPLEMENTATION]"
          output.prompt = buildImplementUserPrompt(s)
          writeStateFile(hookInput.sessionID, s)
          return
        }

        if (s.iterations >= s.max) {
          s.status = "max_reached"
          s.active = false
          activeSession = null
          writeFinalState(hookInput.sessionID, s)
          delete state[hookInput.sessionID]
          output.stop = true
          return
        }

        output.stop = false
        output.systemMessage = `[TDD - TEST GENERATION (${s.iterations}/${s.max})]`
        output.prompt = "Continue generating test files. When complete: <promise>TESTS_WRITTEN</promise>"
        writeStateFile(hookInput.sessionID, s)
        return
      }

      // ======================================================================
      // PHASE: IMPLEMENT
      // ======================================================================
      if (s.phase === "implement") {
        if (checkPromise(text, PROMISES.implement)) {
          // Transition to REVIEW
          s.phase = "review"

          output.stop = false
          output.systemMessage = "[TDD - CODE REVIEW]"
          output.prompt = buildReviewUserPrompt(s)
          writeStateFile(hookInput.sessionID, s)
          return
        }

        if (s.iterations >= s.max) {
          s.status = "max_reached"
          s.active = false
          activeSession = null
          writeFinalState(hookInput.sessionID, s)
          delete state[hookInput.sessionID]
          output.stop = true
          return
        }

        output.stop = false
        output.systemMessage = `[TDD - IMPLEMENTATION (${s.iterations}/${s.max})]`
        output.prompt = "Continue implementing. When complete: <promise>DONE</promise>"
        writeStateFile(hookInput.sessionID, s)
        return
      }

      // ======================================================================
      // PHASE: REVIEW
      // ======================================================================
      if (s.phase === "review") {
        // Check for APPROVED
        if (checkPromise(text, PROMISES.review.approved)) {
          // Transition to TEST_RUN
          s.phase = "test_run"
          writeStateFile(hookInput.sessionID, s)

          // Run tests
          let testOutput = ""
          try {
            const result = await $`${s.testCommand}`.quiet().nothrow()
            testOutput = result.stdout.toString() + "\n" + result.stderr.toString()
          } catch (e: any) {
            testOutput = e.message || "Test execution failed"
          }

          s.lastTestOutput = testOutput
          s.testResults = parseTestResults(testOutput)

          // Check if all tests pass
          if (s.testResults.failed === 0 && s.testResults.total > 0) {
            // SUCCESS: All tests pass - complete the loop!
            s.status = "tests_passing"
            s.active = false
            activeSession = null
            writeFinalState(hookInput.sessionID, s)
            delete state[hookInput.sessionID]

            // Stop the loop - we're done!
            output.stop = true
            return
          }

          // Handle case where no tests were found/parsed
          if (s.testResults.total === 0) {
            // Treat as failure - tests may not have run correctly
            s.testResults.failed = 1
            s.testResults.total = 1
          }

          // FAILURE: Tests failed - go to FIX phase
          s.phase = "fix"
          // Clear review feedback since this is a test failure, not a review failure
          s.lastReviewFeedback = ""
          output.stop = false
          output.systemMessage = `[TDD - FIX MODE (${s.testResults.failed} tests failed)]`
          output.prompt = buildFixUserPrompt(s)
          writeStateFile(hookInput.sessionID, s)
          return
        }

        // Check for NEEDFIX
        if (checkPromise(text, PROMISES.review.needfix)) {
          if (s.reviewCount >= s.maxReviews) {
            s.status = "max_reviews_reached"
            s.active = false
            activeSession = null
            writeFinalState(hookInput.sessionID, s)
            delete state[hookInput.sessionID]
            output.stop = true
            return
          }

          s.phase = "fix"
          s.lastReviewFeedback = text
          s.reviewCount++

          output.stop = false
          output.systemMessage = `[TDD - FIX MODE (Review #${s.reviewCount})]`
          output.prompt = buildFixUserPrompt(s)
          writeStateFile(hookInput.sessionID, s)
          return
        }

        // Neither promise found - nudge
        output.stop = false
        output.systemMessage = "[TDD - REVIEW - Awaiting verdict]"
        output.prompt = `Please complete the review and respond with:
- <promise>APPROVED</promise> if code is ready
- <promise>NEEDFIX</promise> if issues need fixing`
        return
      }

      // ======================================================================
      // PHASE: TEST_RUN (should not reach here normally)
      // ======================================================================
      if (s.phase === "test_run") {
        // This phase is handled inline during REVIEW->APPROVED transition
        output.stop = true
        return
      }

      // ======================================================================
      // PHASE: FIX
      // ======================================================================
      if (s.phase === "fix") {
        if (checkPromise(text, PROMISES.fix)) {
          // Go back to REVIEW for re-review
          s.phase = "review"

          output.stop = false
          output.systemMessage = `[TDD - RE-REVIEW (Review #${s.reviewCount + 1})]`
          output.prompt = buildReReviewUserPrompt(s)
          writeStateFile(hookInput.sessionID, s)
          return
        }

        if (s.iterations >= s.max) {
          s.status = "max_reached"
          s.active = false
          activeSession = null
          writeFinalState(hookInput.sessionID, s)
          delete state[hookInput.sessionID]
          output.stop = true
          return
        }

        output.stop = false
        output.systemMessage = `[TDD - FIX MODE (${s.iterations}/${s.max})]`
        output.prompt = "Continue fixing issues. When complete: <promise>DONE</promise>"
        writeStateFile(hookInput.sessionID, s)
        return
      }
    },

    // ========================================================================
    // System Prompt Transform - Inject phase-specific prompts
    // ========================================================================
    async ["experimental.chat.system.transform"](_input: {}, output: { system: string[] }): Promise<void> {
      if (!activeSession) return

      const s = state[activeSession]
      if (!s?.active) {
        activeSession = null
        return
      }

      switch (s.phase) {
        case "plan":
          output.system.push(PLAN_SYSTEM_PROMPT)
          break
        case "test_gen":
          output.system.push(TEST_GEN_SYSTEM_PROMPT)
          break
        case "implement":
          output.system.push(IMPLEMENT_SYSTEM_PROMPT)
          break
        case "review":
          output.system.push(REVIEW_SYSTEM_PROMPT)
          break
        case "test_run":
          output.system.push(TEST_RUN_SYSTEM_PROMPT)
          break
        case "fix":
          output.system.push(FIX_SYSTEM_PROMPT)
          break
      }
    },
  }
}

export default tddLoop
