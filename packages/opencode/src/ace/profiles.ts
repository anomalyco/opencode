import type { AceConfig } from "./policy"

export const PROFILE_IDS = ["create-file", "refactor", "bugfix", "unit-tests"] as const
export type ProfileId = (typeof PROFILE_IDS)[number]

const TEMPLATES: Record<ProfileId, string> = {
  "create-file": [
    "TASK: Create a new file at the specified path with the exact requested functionality.",
    "",
    "Target Path: {{TARGET_FILE_PATH}}",
    "Language/Framework: {{TECH_STACK}}",
    "Requirements:",
    "{{REQUIREMENTS_BLOCK}}",
    "",
    "EXECUTION STEPS:",
    "1. Create the file at Target Path with complete, production-ready code (imports and types included).",
    "2. Run lint/typecheck on the new file (see Tool mapping).",
    "3. If verification fails, fix errors and re-run (max {{MAX_RETRIES}} attempts).",
    "4. Stop when verification passes.",
  ].join("\n"),
  refactor: [
    "TASK: Refactor the target file to meet the architectural guidelines provided.",
    "",
    "Target Path: {{TARGET_FILE_PATH}}",
    "Refactoring Goal: {{REFACTORING_GOAL}}",
    "",
    "EXECUTION STEPS:",
    "1. Read Target Path and understand current implementation.",
    "2. Run tests scoped to the target area to establish a passing baseline.",
    "3. Apply minimal edits for the refactoring goal. Do not change external API signatures unless explicitly requested.",
    "4. Re-run the same tests.",
    "5. If tests fail, fix regressions (max {{MAX_RETRIES}} attempts).",
    "6. Stop when tests pass.",
  ].join("\n"),
  bugfix: [
    "TASK: Implement a minimal patch to resolve the provided error or issue.",
    "",
    "Target Path(s): {{TARGET_PATHS}}",
    "Issue Description / Error Trace:",
    "{{ERROR_TRACE}}",
    "",
    "EXECUTION STEPS:",
    "1. Read relevant Target Paths.",
    "2. Identify root cause from the error trace.",
    "3. Apply the smallest correct fix. Do not rewrite unrelated code.",
    "4. Run tests targeted at the failing component.",
    "5. If the error persists, analyze output and retry (max {{MAX_RETRIES}} attempts).",
    "6. Stop when the error is resolved and tests pass.",
  ].join("\n"),
  "unit-tests": [
    "TASK: Generate a complete unit test suite for the provided source file.",
    "",
    "Source File: {{SOURCE_FILE_PATH}}",
    "Test File Destination: {{TEST_FILE_PATH}}",
    "Testing Framework: {{TEST_FRAMEWORK}}",
    "",
    "EXECUTION STEPS:",
    "1. Read Source File; identify exports, edge cases, and dependencies.",
    "2. Create Test File Destination with positive, negative, and boundary cases.",
    "3. Run the test runner for the new file only.",
    "4. If tests fail, determine whether the test or source is wrong; fix the test file accordingly.",
    "5. Stop when all tests pass.",
  ].join("\n"),
}

function isProfileId(value: string): value is ProfileId {
  return (PROFILE_IDS as readonly string[]).includes(value)
}

function maxRetries(config: AceConfig | undefined) {
  const n = config?.headless?.executionMode?.maxRetriesOnVerifyFail
  return n !== undefined && n > 0 ? String(n) : "3"
}

function substitute(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    template,
  )
}

export type ProfileTaskParams = {
  profile?: string
  command?: string
  prompt: string
  target_path?: string
  target_paths?: string
  test_path?: string
  tech_stack?: string
  test_framework?: string
}

export function resolveProfileId(params: ProfileTaskParams) {
  if (params.profile && isProfileId(params.profile)) return params.profile
  if (params.command && isProfileId(params.command)) return params.command
  return undefined
}

export function composeProfilePrompt(params: ProfileTaskParams, config: AceConfig | undefined) {
  const id = resolveProfileId(params)
  if (!id) return undefined
  const retries = maxRetries(config)
  const target = params.target_path ?? "(infer from task prompt)"
  const paths = params.target_paths ?? params.target_path ?? "(infer from task prompt)"
  const vars: Record<string, string> = {
    TARGET_FILE_PATH: target,
    TARGET_PATHS: paths,
    SOURCE_FILE_PATH: target,
    TEST_FILE_PATH: params.test_path ?? "(infer from repo conventions)",
    TECH_STACK: params.tech_stack ?? "(infer from repository)",
    TEST_FRAMEWORK: params.test_framework ?? "bun test",
    REQUIREMENTS_BLOCK: params.prompt,
    REFACTORING_GOAL: params.prompt,
    ERROR_TRACE: params.prompt,
    MAX_RETRIES: retries,
  }
  return substitute(TEMPLATES[id], vars)
}

export function taskPromptBody(params: ProfileTaskParams, config: AceConfig | undefined) {
  return composeProfilePrompt(params, config) ?? params.prompt
}
