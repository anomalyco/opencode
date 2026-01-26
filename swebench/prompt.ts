/**
 * SWE-bench Prompt Templates
 */

import type { SWEInstance } from "./types"

/** Build prompt to send to opencode */
export function buildPrompt(instance: SWEInstance): string {
  const parts: string[] = []

  parts.push(`You are an expert software engineer tasked with fixing a bug in a GitHub repository.

## Task
Fix the issue described below. Make minimal, focused changes that directly address the problem.

## Repository Information
- **Repository**: ${instance.repo}
- **Version**: ${instance.version}
- **Base Commit**: ${instance.base_commit}

## Problem Statement
${instance.problem_statement}`)

  if (instance.hints_text) {
    parts.push(`
## Hints
${instance.hints_text}`)
  }

  parts.push(`
## Instructions
1. First, explore the codebase to understand the project structure and locate relevant files
2. Analyze the issue carefully to understand what needs to be fixed
3. Make the necessary code changes to fix the bug
4. Ensure your changes are minimal and focused - only modify what is necessary
5. Do NOT add new tests or modify existing test files
6. Do NOT modify any configuration files unless absolutely necessary for the fix
7. After making changes, verify they address the issue described

## Important Notes
- The repository has already been cloned and checked out to the correct commit
- You have full access to read and modify files in the repository
- Focus on producing a clean, minimal patch that fixes the described issue
- If the issue mentions specific files or line numbers, start your investigation there`)

  return parts.join("\n")
}

/** Build compact prompt (for quick testing) */
export function buildCompactPrompt(instance: SWEInstance): string {
  return `Fix this bug in ${instance.repo}:

${instance.problem_statement}

Instructions:
- Make minimal changes to fix the issue
- Do NOT modify test files
- Repository is already cloned at the correct commit`
}
