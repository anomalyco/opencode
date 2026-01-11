/**
 * Ralph Wiggum Plugin for OpenCode
 * Implements the Ralph Wiggum technique for iterative, self-referential AI development loops.
 *
 * Based on: https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
 *
 * Usage:
 *   ralph-loop "Your task here" --max 8 --promise "DONE"
 *   ralph-loop "Your task here" --max 8 --promise "DONE" --state-file /custom/path.json
 *   ralph-loop "Your task here" --no-state  # Disable state file
 *
 * The loop will:
 * 1. Execute the prompt
 * 2. Continue iterating until max iterations OR completion promise is found
 * 3. Feed the SAME original prompt back each iteration
 * 4. Show iteration count in system message
 * 5. Write state to ~/.config/opencode/state/ralph-wiggum.json (or custom path) for verification
 */

import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"

// Default state file path
const DEFAULT_STATE_DIR = join(homedir(), ".config", "opencode", "state")
const DEFAULT_STATE_FILE = join(DEFAULT_STATE_DIR, "ralph-wiggum.json")

// Task 1: Add ReviewPhase type
type ReviewPhase = "working" | "review" | "fix"

// Task 1: Extend RalphState with review system fields
type RalphState = {
  active: boolean
  prompt: string
  promise?: string
  max?: number
  iterations: number
  stateFile: string | null
  startedAt: string
  lastUpdatedAt: string
  status: "running" | "completed" | "cancelled" | "max_reached" | "approved" | "max_reviews_reached"
  // Review system fields
  phase: ReviewPhase
  reviewPromises: {
    needFix: string
    approved: string
  }
  lastReviewFeedback?: string
  reviewCount: number
  maxReviews: number
}

const state: Record<string, RalphState> = {}

// Task 1: Track active review session for system prompt injection
let activeReviewSession: string | null = null

/**
 * Ensure directory exists for state file
 */
function ensureDir(filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
  } catch {
    // Ignore errors
  }
}

/**
 * Clean up existing state file on start
 */
function cleanupExistingStateFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  } catch {
    // Ignore errors
  }
}

// Task 10: Update writeStateFile to include review system fields
function writeStateFile(sessionID: string, s: RalphState): void {
  if (!s.stateFile) return
  try {
    ensureDir(s.stateFile)
    const stateData = {
      sessionID,
      active: s.active,
      prompt: s.prompt,
      promise: s.promise || "DONE",
      iterations: s.iterations,
      max: s.max ?? null,
      remaining: s.max != null ? s.max - s.iterations : null,
      startedAt: s.startedAt,
      lastUpdatedAt: new Date().toISOString(),
      status: s.status,
      // Review system fields
      phase: s.phase,
      reviewCount: s.reviewCount,
      maxReviews: s.maxReviews,
      lastReviewFeedback: s.lastReviewFeedback || null,
    }
    writeFileSync(s.stateFile, JSON.stringify(stateData, null, 2))
  } catch {
    // Silently ignore write errors
  }
}

/**
 * Write final state when loop ends
 */
function writeFinalState(sessionID: string, s: RalphState): void {
  if (!s.stateFile) return
  s.lastUpdatedAt = new Date().toISOString()
  writeStateFile(sessionID, s)
}

/**
 * Tokenize a string respecting quoted strings.
 * Handles both single and double quotes, preserving content within quotes as single tokens.
 * Also handles escape sequences like \" and \\
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    // Handle escape sequences
    if (char === "\\" && i + 1 < input.length) {
      const nextChar = input[i + 1]
      if (nextChar === '"' || nextChar === "'" || nextChar === "\\") {
        // Escaped quote or backslash - add the escaped character
        current += nextChar
        i++ // Skip the next character
        continue
      }
    }

    if (inQuote) {
      if (char === inQuote) {
        // End of quoted section
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      // Start of quoted section
      inQuote = char
    } else if (char === " " || char === "\t") {
      // Whitespace outside quotes - token boundary
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }

  // Don't forget the last token
  if (current) {
    tokens.push(current)
  }

  return tokens
}

// Parse arguments from command invocation
// Supports: ralph-loop "prompt text with spaces" --max 5 --promise "DONE" --state-file /tmp/ralph.json --no-state
function parseArgs(args: string): {
  prompt: string
  maxIterations: number
  completionPromise?: string
  stateFile: string | null
} {
  let input = args.trim()

  // Handle CLI double-quoting: if the entire input is wrapped in quotes with escaped inner quotes,
  // strip the outer quotes and unescape the inner ones
  // e.g., "\"say hello\" --max 2" -> "say hello" --max 2
  if (input.startsWith('"') && input.endsWith('"') && input.length > 2) {
    // Check if this looks like double-quoted input (contains escaped quotes inside)
    const inner = input.slice(1, -1)
    if (inner.includes('\\"')) {
      // Unescape the inner quotes and use that as input
      input = inner.replace(/\\"/g, '"')
    }
  }

  const tokens = tokenize(input)
  const promptParts: string[] = []
  let maxIterations = 8
  let completionPromise: string | undefined
  let stateFile: string | null = DEFAULT_STATE_FILE
  let noState = false

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === "--max" || token === "--max-iterations") {
      maxIterations = parseInt(tokens[++i] || "8", 10)
    } else if (token === "--promise" || token === "--completion-promise") {
      completionPromise = tokens[++i]
    } else if (token === "--state-file" || token === "--state") {
      stateFile = tokens[++i] || DEFAULT_STATE_FILE
    } else if (token === "--no-state") {
      noState = true
    } else {
      // Accumulate as prompt
      promptParts.push(token)
    }
    i++
  }

  return {
    prompt: promptParts.join(" ") || "Continue working on the task",
    maxIterations,
    completionPromise,
    stateFile: noState ? null : stateFile,
  }
}

/**
 * Check if the assistant's response contains the completion promise.
 * Looks for <promise>TEXT</promise> pattern where TEXT matches the expected promise.
 */
function checkCompletionPromise(text: string | undefined, expectedPromise: string | undefined): boolean {
  if (!text || !expectedPromise) return false

  // Look for <promise>TEXT</promise> pattern
  const promiseRegex = /<promise>([\s\S]*?)<\/promise>/gi
  const matches = text.matchAll(promiseRegex)

  for (const match of matches) {
    const promiseText = match[1].trim()
    if (promiseText === expectedPromise) {
      return true
    }
  }

  return false
}

// Task 2: System prompt for REVIEW phase
const REVIEW_SYSTEM_PROMPT = `
<ralph-review-mode>
## Code Review Mode Active

You are in CODE REVIEW mode. Be EXTREMELY THOROUGH and CRITICAL. Do not rubber-stamp changes.

### Review Philosophy
- Assume there ARE issues until proven otherwise
- Question every design decision
- Look for what's missing, not just what's wrong
- Consider maintainability, scalability, and future implications
- A good review finds problems; an excellent review prevents future ones

### 1. Retrieve and Inspect Changes
- Run \`git diff HEAD --stat\` to see which files changed
- Run \`git diff HEAD\` or \`git diff HEAD -- <file>\` to inspect specific changes
- Run \`git status\` to see untracked files
- Read full files if needed for context
- Do NOT skip any files - review everything

### 2. Design Review (Be Critical)
- Is this the RIGHT solution, not just A solution?
- Are there simpler approaches that were overlooked?
- Does the architecture make sense for the problem?
- Will this scale? Is it maintainable?
- Are there unnecessary abstractions or missing abstractions?

### 3. Spec Compliance (Be Thorough)
- Verify EVERY requirement from the original spec is addressed
- Check for missing functionality or incomplete implementations
- Look for requirements that were misunderstood
- Verify edge cases mentioned in the spec are handled

### 4. Code Quality Review (Be Rigorous)
- Look for bugs, logic errors, race conditions, edge cases
- Check error handling - what happens when things fail?
- Review security implications (injection, auth, data exposure)
- Check for performance issues (N+1 queries, memory leaks, blocking calls)
- Verify proper input validation and sanitization
- Look for code smells and anti-patterns

### 5. E2E Test Verification (MANDATORY - DO NOT SKIP)
**CRITICAL: You MUST verify e2e tests exist and pass before approving.**

1. **Check for e2e test files**: Look for test files that cover the changes (*.test.ts, *.e2e.ts, *.spec.ts)
2. **Verify critical/high priority e2e tests are added**: Check that tests exist for:
   - All CRITICAL functionality changes
   - All HIGH priority user-facing features
   - Tests that verify the UX exactly like a user would interact with it
3. **Run the tests**: Execute \`bun test\` or the appropriate test command
4. **Verify tests pass**: ALL tests must pass. If any fail, this is a CRITICAL issue.

**YOU CANNOT APPROVE IF:**
- Critical/high priority e2e tests are missing
- Any tests fail
- Tests do not adequately cover the changes

### 6. Test Recommendations (if tests are missing)
If e2e tests are missing, list SPECIFIC tests that MUST be added:
- **CRITICAL**: E2E tests for core functionality that a user would interact with
- **HIGH**: E2E tests for important user flows and edge cases

### Required Response
After your review, you MUST respond with ONE of:
- <promise>APPROVED</promise> - Code meets ALL requirements, critical/high priority e2e tests are added AND passing, design is sound
- <promise>NEEDFIX</promise> - Issues found that must be addressed (including missing or failing tests)

**IMPORTANT**: Do NOT approve if:
1. Critical/high priority e2e tests are not added
2. Tests are failing
3. Test coverage is inadequate for the changes

If responding with NEEDFIX, list EVERY issue with priority:
- **CRITICAL**: Bugs, security issues, data loss risks, spec violations, missing e2e tests, failing tests
- **HIGH**: Design flaws, missing error handling, performance issues, inadequate test coverage
</ralph-review-mode>
`

// Task 2: System prompt for FIX phase
const FIX_SYSTEM_PROMPT = `
<ralph-fix-mode>
## Fix Mode Active

You are addressing review comments. Your responsibilities:

### 1. Address Review Issues
- Fix all CRITICAL and HIGH priority issues identified
- Refer to the review feedback for specific issues to address

### 2. Implement E2E Tests (MANDATORY)
**CRITICAL: You MUST add all missing critical/high priority e2e tests before marking complete.**
- Add ALL recommended E2E tests that verify UX exactly like a user would
- Add unit tests for individual functions/components
- E2E tests MUST cover all critical functionality changes
- E2E tests MUST cover all high priority user-facing features

### 3. Run and Verify Tests (MANDATORY)
**YOU MUST run the tests and verify they pass before marking complete.**
- Run \`bun test\` or the appropriate test command
- ALL tests must pass
- If any test fails, fix the issue before marking complete
- Do NOT mark as done if tests are failing

### Required Response
When all fixes are complete AND all e2e tests are added AND tests pass, respond with:
<promise>DONE</promise>

**IMPORTANT**: Do NOT respond with DONE if:
1. Critical/high priority e2e tests are not added
2. Any tests are failing

This will trigger a re-review of the updated changes.
</ralph-fix-mode>
`

// Task 2: Build review user prompt
function buildReviewUserPrompt(s: RalphState): string {
  return `## Code Review Request

The code implementation is complete. Please review the uncommitted changes.

### Original Task/Specification:
\`\`\`
${s.prompt}
\`\`\`

### Instructions:
1. Run \`git diff HEAD --stat\` to see which files were modified
2. Run \`git diff HEAD\` or \`git diff HEAD -- <file>\` to inspect the actual changes
3. Run \`git status\` to see untracked files
4. Read full files if you need more context

### Review Checklist:
1. **Spec Compliance**: Does this implementation fulfill the original requirements?
2. **Code Quality**: Are there bugs, logic errors, edge cases, or security issues?
3. **E2E Test Verification (MANDATORY)**:
   - Check if e2e test files exist for the changes (*.test.ts, *.e2e.ts, *.spec.ts)
   - Verify ALL critical/high priority functionality has corresponding e2e tests
   - Run \`bun test\` to execute all tests
   - Verify ALL tests pass - do not skip this step

### Required Response:
- If critical/high priority e2e tests are MISSING: <promise>NEEDFIX</promise>
- If ANY tests are FAILING: <promise>NEEDFIX</promise>
- If the code is acceptable, all e2e tests exist, AND all tests pass: <promise>APPROVED</promise>

**IMPORTANT: You CANNOT approve if critical/high priority e2e tests are missing or any tests are failing.**`
}

// Task 2: Build fix user prompt
function buildFixUserPrompt(s: RalphState): string {
  return `## Fix Review Comments

The code review identified issues that need to be addressed.

### Review Feedback:
${s.lastReviewFeedback}

### Original Task/Specification:
\`\`\`
${s.prompt}
\`\`\`

### Instructions:
1. Address all CRITICAL and HIGH priority issues from the review above
2. **Add ALL missing critical/high priority E2E tests** (tests that verify UX exactly like a user would)
3. Add the recommended unit tests
4. **Run \`bun test\` to execute all tests** - do not skip this step
5. **Verify ALL tests pass** - if any fail, fix the issue
6. Only mark as done when tests are added AND passing

When all fixes are complete AND all critical/high priority e2e tests are added AND ALL tests pass, respond with:
<promise>DONE</promise>

**IMPORTANT: Do NOT respond with DONE if e2e tests are missing or any tests are failing.**`
}

// Task 2: Build re-review user prompt
function buildReReviewUserPrompt(s: RalphState): string {
  return `## Re-Review Request (Review #${s.reviewCount + 1})

The previous review comments have been addressed. Please verify the fixes.

### Original Task/Specification:
\`\`\`
${s.prompt}
\`\`\`

### Instructions:
1. Run \`git diff HEAD --stat\` to see current changes
2. Run \`git diff HEAD\` to inspect the updated code
3. Run \`git status\` to see untracked files
4. Verify all previous issues are resolved
5. Check that new changes don't introduce new issues
6. **Verify critical/high priority e2e tests are added** - check for test files
7. **Run \`bun test\` to execute all tests** - do not skip this step
8. **Verify ALL tests pass**

### Required Response:
- If critical/high priority e2e tests are still MISSING: <promise>NEEDFIX</promise>
- If ANY tests are FAILING: <promise>NEEDFIX</promise>
- If more issues remain: <promise>NEEDFIX</promise>
- If everything is acceptable, all e2e tests exist, AND all tests pass: <promise>APPROVED</promise>

**IMPORTANT: You CANNOT approve if critical/high priority e2e tests are missing or any tests are failing.**`
}

export default async function ralphWiggum(input: {
  client: any
  project: string
  worktree: string
  directory: string
  serverUrl: string
  $: any
}) {
  return {
    command: {
      "ralph-loop": {
        description:
          "Start a self-referential Ralph loop. Usage: ralph-loop <prompt> --max <iterations> --promise <text> --state-file <path>",
        template: `You are now in a Ralph Wiggum iterative development loop.

The user wants you to work on the following task iteratively:
$ARGUMENTS

Instructions:
1. Work on the task step by step
2. After each iteration, the loop will automatically continue
3. The loop will stop when max iterations is reached OR you output <promise>TEXT</promise> where TEXT matches the completion promise
4. Focus on making progress with each iteration
5. When you believe the task is complete, output <promise>COMPLETION_PROMISE_TEXT</promise>

Begin working on the task now.`,
      },
      "cancel-ralph": {
        description: "Cancel the active Ralph loop",
        template: "The Ralph loop has been cancelled. Stop the current iteration.",
      },
      "ralph-status": {
        description: "Show the current Ralph loop status",
        template: "Show the current Ralph loop status for this session.",
      },
    },

    tool: {
      // Task 9: Update cancel-ralph tool
      "cancel-ralph": {
        description: "Cancel the active Ralph loop for the current session",
        args: {},
        async execute(_args: {}, ctx: any) {
          const sessionID = ctx.sessionID
          const s = state[sessionID]
          if (s) {
            s.status = "cancelled"
            s.active = false
            writeFinalState(sessionID, s)
            delete state[sessionID]

            // Clear active review session if this was it
            if (activeReviewSession === sessionID) {
              activeReviewSession = null
            }

            return "Ralph loop cancelled"
          }
          return "No active Ralph loop to cancel"
        },
      },
      // Task 8: Update ralph-status tool
      "ralph-status": {
        description: "Get the current Ralph loop status for the session",
        args: {},
        async execute(_args: {}, ctx: any) {
          const sessionID = ctx.sessionID
          const s = state[sessionID]
          if (!s?.active) {
            return "No active Ralph loop"
          }
          const remaining = s.max != null ? s.max - s.iterations : "unlimited"
          return JSON.stringify(
            {
              active: s.active,
              prompt: s.prompt,
              promise: s.promise || "DONE",
              iterations: s.iterations,
              max: s.max ?? "unlimited",
              remaining,
              phase: s.phase,
              reviewCount: s.reviewCount,
              maxReviews: s.maxReviews,
              reviewPromises: s.reviewPromises,
              stateFile: s.stateFile || "none",
              startedAt: s.startedAt,
              status: s.status,
            },
            null,
            2,
          )
        },
      },
    },

    // Task 4: Update event hook to initialize review system fields
    async ["event"](input: { event: any }): Promise<void> {
      const event = input.event
      if (event?.type === "command.executed" && event?.properties?.name === "ralph-loop") {
        const sessionID = event.properties.sessionID
        const args = parseArgs(event.properties.arguments || "")
        const now = new Date().toISOString()

        // Clean up existing state file on start
        if (args.stateFile) {
          cleanupExistingStateFile(args.stateFile)
        }

        state[sessionID] = {
          active: true,
          prompt: args.prompt,
          promise: args.completionPromise || "DONE",
          max: args.maxIterations,
          iterations: 0,
          stateFile: args.stateFile,
          startedAt: now,
          lastUpdatedAt: now,
          status: "running",
          // Review system fields
          phase: "working",
          reviewPromises: {
            needFix: "NEEDFIX",
            approved: "APPROVED",
          },
          reviewCount: 0,
          maxReviews: 5,
        }
        // Write initial state
        writeStateFile(sessionID, state[sessionID])
      }
    },

    // Tasks 5, 6, 7: Update session.stop hook with WORKING, REVIEW, FIX phase logic
    async ["session.stop"](
      hookInput: { sessionID: string; step: number; lastAssistantText?: string },
      output: { stop: boolean; prompt?: string; systemMessage?: string },
    ): Promise<void> {
      const s = state[hookInput.sessionID]
      if (!s?.active) {
        return // No active loop, let it stop
      }

      s.iterations++
      s.lastUpdatedAt = new Date().toISOString()

      // Task 5: WORKING PHASE
      if (s.phase === "working") {
        // Check for completion promise (DONE)
        if (checkCompletionPromise(hookInput.lastAssistantText, s.promise)) {
          // Check if this is a git repo, auto-init if not
          const isGitRepo = await input.$`git rev-parse --is-inside-work-tree`.text().catch(() => "false")

          if (isGitRepo.trim() !== "true") {
            // Auto-initialize git repo
            await input.$`git init`.quiet().catch(() => {})
          }

          // Check for changes that should trigger review
          // Use git status --porcelain to detect staged, unstaged, and untracked files
          const gitStatus = await input.$`git status --porcelain`.text().catch(() => "")
          const hasChanges = gitStatus.trim().length > 0

          if (!hasChanges) {
            // No changes - exit normally
            s.status = "completed"
            s.active = false
            writeFinalState(hookInput.sessionID, s)
            delete state[hookInput.sessionID]
            output.stop = true
            return
          }

          // Transition to REVIEW phase
          s.phase = "review"
          activeReviewSession = hookInput.sessionID

          output.stop = false
          output.systemMessage = `[Ralph - CODE REVIEW MODE]`
          output.prompt = buildReviewUserPrompt(s)
          writeStateFile(hookInput.sessionID, s)
          return
        }

        // Check max iterations
        if (s.max != null && s.iterations >= s.max) {
          s.status = "max_reached"
          s.active = false
          activeReviewSession = null
          writeFinalState(hookInput.sessionID, s)
          delete state[hookInput.sessionID]
          output.stop = true
          return
        }

        // Continue working - existing logic
        output.stop = false
        output.prompt = s.prompt
        const promiseHint = s.promise ? ` | When complete: <promise>${s.promise}</promise>` : ""
        output.systemMessage = `[Ralph iteration ${s.iterations + 1}/${s.max ?? "∞"}${promiseHint}]`
        writeStateFile(hookInput.sessionID, s)
        return
      }

      // Task 6: REVIEW PHASE
      if (s.phase === "review") {
        // Check for APPROVED
        if (checkCompletionPromise(hookInput.lastAssistantText, s.reviewPromises.approved)) {
          s.status = "approved"
          s.active = false
          activeReviewSession = null
          writeFinalState(hookInput.sessionID, s)
          delete state[hookInput.sessionID]
          output.stop = true
          return
        }

        // Check for NEEDFIX
        if (checkCompletionPromise(hookInput.lastAssistantText, s.reviewPromises.needFix)) {
          // Check max reviews limit
          if (s.reviewCount >= s.maxReviews) {
            s.status = "max_reviews_reached"
            s.active = false
            activeReviewSession = null
            writeFinalState(hookInput.sessionID, s)
            delete state[hookInput.sessionID]
            output.stop = true
            return
          }

          // Transition to FIX phase
          s.phase = "fix"
          s.lastReviewFeedback = hookInput.lastAssistantText
          s.reviewCount++

          output.stop = false
          output.systemMessage = `[Ralph - FIX MODE (Review #${s.reviewCount})]`
          output.prompt = buildFixUserPrompt(s)
          writeStateFile(hookInput.sessionID, s)
          return
        }

        // Neither promise found - nudge for response
        output.stop = false
        output.systemMessage = `[Ralph - REVIEW MODE - Awaiting verdict]`
        output.prompt = `Please complete your review by inspecting the changes with \`git diff HEAD\` and \`git status\` and respond with:
- <promise>APPROVED</promise> if the code meets requirements
- <promise>NEEDFIX</promise> if there are critical/high priority issues`
        return
      }

      // Task 7: FIX PHASE
      if (s.phase === "fix") {
        // Check for DONE (fixes complete)
        if (checkCompletionPromise(hookInput.lastAssistantText, s.promise)) {
          // Transition back to REVIEW for re-review
          s.phase = "review"

          output.stop = false
          output.systemMessage = `[Ralph - RE-REVIEW MODE (Review #${s.reviewCount + 1})]`
          output.prompt = buildReReviewUserPrompt(s)
          writeStateFile(hookInput.sessionID, s)
          return
        }

        // Check max iterations (safety valve)
        if (s.max != null && s.iterations >= s.max) {
          s.status = "max_reached"
          s.active = false
          activeReviewSession = null
          writeFinalState(hookInput.sessionID, s)
          delete state[hookInput.sessionID]
          output.stop = true
          return
        }

        // Continue fixing
        output.stop = false
        output.systemMessage = `[Ralph - FIX MODE - Addressing review comments]`
        output.prompt = s.prompt
        return
      }
    },

    // Task 3: Add experimental.chat.system.transform hook
    async ["experimental.chat.system.transform"](_input: {}, output: { system: string[] }): Promise<void> {
      if (!activeReviewSession) return

      const s = state[activeReviewSession]
      if (!s?.active) {
        activeReviewSession = null
        return
      }

      if (s.phase === "review") {
        output.system.push(REVIEW_SYSTEM_PROMPT)
      } else if (s.phase === "fix") {
        output.system.push(FIX_SYSTEM_PROMPT)
      }
    },
  }
}
