export * as Profile from "./profile"

import { Schema } from "effect"

export const DeveloperStyle = Schema.Struct({
  explicitness: Schema.Number.annotate({ description: "0.0 for magical/decorators, 1.0 for explicit dataflow" }),
  abstraction_tolerance: Schema.Number.annotate({ description: "0.0 for flat composable functions, 1.0 for deep OOP layers" }),
  verbosity: Schema.Number.annotate({ description: "0.0 for direct code-only, 1.0 for verbose explanations" }),
  typing_rigor: Schema.Number.annotate({ description: "0.0 for loose typing, 1.0 for strict typing without any" }),
  inlining_preference: Schema.Number.annotate({ description: "0.0 for multi-var assignments, 1.0 for inlining single-use vars" }),
}).annotate({ identifier: "Personalization.DeveloperStyle" })

export type DeveloperStyle = typeof DeveloperStyle.Type

export const ArchitecturePreference = Schema.Struct({
  paradigm: Schema.String.annotate({ description: "e.g. 'functional_composable', 'object_oriented', 'actor_model'" }),
  modularity: Schema.String.annotate({ description: "e.g. 'flat_modules', 'feature_sliced', 'clean_hexagonal'" }),
  immutability: Schema.Boolean.annotate({ description: "true for strict immutable data structures" }),
  dependency_pattern: Schema.String.annotate({ description: "e.g. 'effect_layers', 'constructor_injection', 'direct_imports'" }),
}).annotate({ identifier: "Personalization.ArchitecturePreference" })

export type ArchitecturePreference = typeof ArchitecturePreference.Type

export const SecurityPreferences = Schema.Struct({
  mask_secrets_and_ips: Schema.Boolean.annotate({ description: "Never print internal IPs, server URLs, or API keys directly" }),
  restricted_paths: Schema.Array(Schema.String).annotate({ description: "Protected paths e.g. ['.env', 'credentials', '.git']" }),
  allow_external_telemetry: Schema.Boolean.annotate({ description: "false for local-first strictly private execution" }),
  local_first_execution: Schema.Boolean.annotate({ description: "true for local processing without external uploads" }),
}).annotate({ identifier: "Personalization.SecurityPreferences" })

export type SecurityPreferences = typeof SecurityPreferences.Type

export const AutomationPreferences = Schema.Struct({
  allow_browser_automation: Schema.Boolean.annotate({ description: "Strict prohibition: never do browser automation testing" }),
  allow_sleep_wait_loops: Schema.Boolean.annotate({ description: "Strict prohibition: never waste tokens on sleep/wait loops" }),
  auto_test_verification: Schema.Boolean.annotate({ description: "Automatically run package-level tests to verify changes" }),
  max_autonomous_depth: Schema.Number.annotate({ description: "Maximum autonomous tool chaining depth" }),
  confirmation_prompts: Schema.Boolean.annotate({ description: "true if user requires approval before running modifying commands" }),
}).annotate({ identifier: "Personalization.AutomationPreferences" })

export type AutomationPreferences = typeof AutomationPreferences.Type

export const TestingPreferences = Schema.Struct({
  testing_framework: Schema.String.annotate({ description: "e.g. 'vitest', 'pytest', 'testing_go'" }),
  table_driven_tests: Schema.Boolean.annotate({ description: "true for table-driven parameterized test suites" }),
  property_based_testing: Schema.Boolean.annotate({ description: "true for fast-check or hypothesis property tests" }),
  mock_preference: Schema.String.annotate({ description: "e.g. 'avoid_mocks_test_actual_impl', 'interface_mocks'" }),
  benchmark_testing: Schema.Boolean.annotate({ description: "true for including benchmarks with b.ResetTimer()" }),
}).annotate({ identifier: "Personalization.TestingPreferences" })

export type TestingPreferences = typeof TestingPreferences.Type

export const ErrorHandlingPreferences = Schema.Struct({
  concurrency_pattern: Schema.String.annotate({ description: "e.g. 'errgroup_go', 'effect_fibers', 'structured_concurrency'" }),
  error_handling_pattern: Schema.String.annotate({ description: "e.g. 'result_option_monads', 'custom_tagged_errors', 'go_error_values'" }),
  graceful_shutdown: Schema.Boolean.annotate({ description: "true for context-aware graceful termination on cancel" }),
  fail_fast: Schema.Boolean.annotate({ description: "true for early returns and early invariant assertion" }),
}).annotate({ identifier: "Personalization.ErrorHandlingPreferences" })

export type ErrorHandlingPreferences = typeof ErrorHandlingPreferences.Type

export const ToolingPreferences = Schema.Struct({
  preferred_package_manager: Schema.String.annotate({ description: "e.g. 'bun', 'pnpm', 'cargo', 'go'" }),
  prefer_cli: Schema.Boolean.annotate({ description: "true for running CLI commands over manual steps" }),
  prefer_direct_edits: Schema.Boolean.annotate({ description: "true for exact drop-in replacements over full file rewrites" }),
  linter_formatter: Schema.String.annotate({ description: "e.g. 'biome', 'eslint', 'ruff', 'gofmt'" }),
}).annotate({ identifier: "Personalization.ToolingPreferences" })

export type ToolingPreferences = typeof ToolingPreferences.Type

export const WorkspaceAndUIPreferences = Schema.Struct({
  theme_aesthetics: Schema.String.annotate({ description: "e.g. 'dark_sleek', 'high_contrast', 'glassmorphism'" }),
  output_presentation: Schema.String.annotate({ description: "e.g. 'diffs_and_tables_first', 'minimal_clean', 'markdown_links'" }),
  conversational_filler_tolerance: Schema.Number.annotate({ description: "0.0 for zero filler/direct answers, 1.0 for conversational" }),
  prefer_dense_tables: Schema.Boolean.annotate({ description: "true for structured tabular comparisons" }),
}).annotate({ identifier: "Personalization.WorkspaceAndUIPreferences" })

export type WorkspaceAndUIPreferences = typeof WorkspaceAndUIPreferences.Type

export const GitAndVcsPreferences = Schema.Struct({
  branch_naming_convention: Schema.String.annotate({ description: "e.g. 'max_3_words_kebab_case_no_slashes'" }),
  commit_message_format: Schema.String.annotate({ description: "e.g. 'conventional_commits_type_scope_summary'" }),
  default_branch: Schema.String.annotate({ description: "e.g. 'dev'" }),
  pr_workflow: Schema.String.annotate({ description: "e.g. 'merge_to_dev_with_audit_summary'" }),
}).annotate({ identifier: "Personalization.GitAndVcsPreferences" })

export type GitAndVcsPreferences = typeof GitAndVcsPreferences.Type

export const DocumentationPreferences = Schema.Struct({
  docstring_standard: Schema.String.annotate({ description: "e.g. 'google_docstrings', 'jsdoc', 'pep257'" }),
  comment_density: Schema.String.annotate({ description: "e.g. 'non_obvious_constraints_only', 'comprehensive'" }),
  in_chat_full_delivery: Schema.Boolean.annotate({ description: "true for delivering full analysis directly in chat without deferring" }),
  clickable_links: Schema.Boolean.annotate({ description: "true for file:// markdown clickable links" }),
}).annotate({ identifier: "Personalization.DocumentationPreferences" })

export type DocumentationPreferences = typeof DocumentationPreferences.Type

export const DeveloperPlaybook = Schema.Struct({
  routine_name: Schema.String.annotate({ description: "Unique name of recurring playbook e.g. 'add_drizzle_table'" }),
  trigger_pattern: Schema.String.annotate({ description: "Intent trigger e.g. 'When adding or modifying SQLite database tables'" }),
  action_sequence: Schema.Array(Schema.String).annotate({ description: "Ordered sequence of execution steps" }),
  preferred_commands: Schema.Array(Schema.String).annotate({ description: "Exact shell commands to run in sequence" }),
  frequency: Schema.Number.annotate({ description: "Times executed" }),
}).annotate({ identifier: "Personalization.DeveloperPlaybook" })

export type DeveloperPlaybook = typeof DeveloperPlaybook.Type

export const UserProfileData = Schema.Struct({
  languages: Schema.Array(Schema.String),
  frameworks: Schema.Array(Schema.String),
  style: DeveloperStyle,
  architecture: ArchitecturePreference,
  security: SecurityPreferences,
  automation: AutomationPreferences,
  testing: TestingPreferences,
  error_handling: ErrorHandlingPreferences,
  tooling: ToolingPreferences,
  workspace_ui: WorkspaceAndUIPreferences,
  git_vcs: GitAndVcsPreferences,
  documentation: DocumentationPreferences,
  playbooks: Schema.Array(DeveloperPlaybook),
  database_style: Schema.String,
}).annotate({ identifier: "Personalization.UserProfileData" })

export type UserProfileData = typeof UserProfileData.Type

export const DEFAULT_USER_PROFILE: UserProfileData = {
  languages: [],
  frameworks: [],
  style: {
    explicitness: 0.5,
    abstraction_tolerance: 0.5,
    verbosity: 0.5,
    typing_rigor: 0.5,
    inlining_preference: 0.5,
  },
  architecture: {
    paradigm: "standard",
    modularity: "modular",
    immutability: false,
    dependency_pattern: "standard",
  },
  security: {
    mask_secrets_and_ips: true,
    restricted_paths: [".env", ".env.*", "credentials.json", "secrets"],
    allow_external_telemetry: false,
    local_first_execution: true,
  },
  automation: {
    allow_browser_automation: false,
    allow_sleep_wait_loops: false,
    auto_test_verification: true,
    max_autonomous_depth: 10,
    confirmation_prompts: false,
  },
  testing: {
    testing_framework: "",
    table_driven_tests: false,
    property_based_testing: false,
    mock_preference: "standard",
    benchmark_testing: false,
  },
  error_handling: {
    concurrency_pattern: "standard",
    error_handling_pattern: "standard",
    graceful_shutdown: true,
    fail_fast: false,
  },
  tooling: {
    preferred_package_manager: "",
    prefer_cli: true,
    prefer_direct_edits: true,
    linter_formatter: "",
  },
  workspace_ui: {
    theme_aesthetics: "dark_sleek",
    output_presentation: "standard",
    conversational_filler_tolerance: 0.5,
    prefer_dense_tables: false,
  },
  git_vcs: {
    branch_naming_convention: "standard",
    commit_message_format: "conventional_commits",
    default_branch: "dev",
    pr_workflow: "standard",
  },
  documentation: {
    docstring_standard: "standard",
    comment_density: "standard",
    in_chat_full_delivery: true,
    clickable_links: true,
  },
  playbooks: [],
  database_style: "",
}

export type ProfileDelta = {
  languages?: readonly string[]
  frameworks?: readonly string[]
  style?: Partial<DeveloperStyle>
  architecture?: Partial<ArchitecturePreference>
  security?: Partial<SecurityPreferences>
  automation?: Partial<AutomationPreferences>
  testing?: Partial<TestingPreferences>
  error_handling?: Partial<ErrorHandlingPreferences>
  tooling?: Partial<ToolingPreferences>
  workspace_ui?: Partial<WorkspaceAndUIPreferences>
  git_vcs?: Partial<GitAndVcsPreferences>
  documentation?: Partial<DocumentationPreferences>
  playbooks?: readonly DeveloperPlaybook[]
  database_style?: string
}

function clamp(val: number, min: number = 0, max: number = 1): number {
  if (val < min) return min
  if (val > max) return max
  return Math.round(val * 1000) / 1000
}

function mergeUniqueList(current: readonly string[], additions?: readonly string[] | string[]): string[] {
  if (!additions || additions.length === 0) return [...current]
  const set = new Set<string>()
  const result: string[] = []
  for (const item of additions) {
    const norm = item.trim().toLowerCase()
    if (norm && !set.has(norm)) {
      set.add(norm)
      result.push(norm)
    }
  }
  for (const item of current) {
    const norm = item.trim().toLowerCase()
    if (norm && !set.has(norm)) {
      set.add(norm)
      result.push(norm)
    }
  }
  return result
}

/**
 * Applies dynamic drift update: P(t+1) = f(P(t), delta, alpha)
 * Smoothly shifts numeric behavioral dimensions using exponential moving average (EMA)
 * and prioritizes recently observed technologies.
 */
export function applyProfileDrift(
  current: UserProfileData,
  delta: ProfileDelta,
  alpha: number = 0.2,
): UserProfileData {
  const effectiveAlpha = clamp(alpha, 0.01, 1.0)
  const currentStyle = current.style
  const deltaStyle = delta.style ?? {}

  const updatedStyle: DeveloperStyle = {
    explicitness:
      typeof deltaStyle.explicitness === "number"
        ? clamp((1 - effectiveAlpha) * currentStyle.explicitness + effectiveAlpha * deltaStyle.explicitness)
        : currentStyle.explicitness,
    abstraction_tolerance:
      typeof deltaStyle.abstraction_tolerance === "number"
        ? clamp((1 - effectiveAlpha) * currentStyle.abstraction_tolerance + effectiveAlpha * deltaStyle.abstraction_tolerance)
        : currentStyle.abstraction_tolerance,
    verbosity:
      typeof deltaStyle.verbosity === "number"
        ? clamp((1 - effectiveAlpha) * currentStyle.verbosity + effectiveAlpha * deltaStyle.verbosity)
        : currentStyle.verbosity,
    typing_rigor:
      typeof deltaStyle.typing_rigor === "number"
        ? clamp((1 - effectiveAlpha) * currentStyle.typing_rigor + effectiveAlpha * deltaStyle.typing_rigor)
        : currentStyle.typing_rigor,
    inlining_preference:
      typeof deltaStyle.inlining_preference === "number"
        ? clamp((1 - effectiveAlpha) * currentStyle.inlining_preference + effectiveAlpha * deltaStyle.inlining_preference)
        : currentStyle.inlining_preference,
  }

  const updatedArchitecture: ArchitecturePreference = {
    paradigm: delta.architecture?.paradigm?.trim() || current.architecture.paradigm,
    modularity: delta.architecture?.modularity?.trim() || current.architecture.modularity,
    immutability: typeof delta.architecture?.immutability === "boolean" ? delta.architecture.immutability : current.architecture.immutability,
    dependency_pattern: delta.architecture?.dependency_pattern?.trim() || current.architecture.dependency_pattern,
  }

  const updatedSecurity: SecurityPreferences = {
    mask_secrets_and_ips: typeof delta.security?.mask_secrets_and_ips === "boolean" ? delta.security.mask_secrets_and_ips : current.security.mask_secrets_and_ips,
    restricted_paths: delta.security?.restricted_paths?.length ? mergeUniqueList(current.security.restricted_paths, delta.security.restricted_paths) : current.security.restricted_paths,
    allow_external_telemetry: typeof delta.security?.allow_external_telemetry === "boolean" ? delta.security.allow_external_telemetry : current.security.allow_external_telemetry,
    local_first_execution: typeof delta.security?.local_first_execution === "boolean" ? delta.security.local_first_execution : current.security.local_first_execution,
  }

  const updatedAutomation: AutomationPreferences = {
    allow_browser_automation: typeof delta.automation?.allow_browser_automation === "boolean" ? delta.automation.allow_browser_automation : current.automation.allow_browser_automation,
    allow_sleep_wait_loops: typeof delta.automation?.allow_sleep_wait_loops === "boolean" ? delta.automation.allow_sleep_wait_loops : current.automation.allow_sleep_wait_loops,
    auto_test_verification: typeof delta.automation?.auto_test_verification === "boolean" ? delta.automation.auto_test_verification : current.automation.auto_test_verification,
    max_autonomous_depth: typeof delta.automation?.max_autonomous_depth === "number" ? delta.automation.max_autonomous_depth : current.automation.max_autonomous_depth,
    confirmation_prompts: typeof delta.automation?.confirmation_prompts === "boolean" ? delta.automation.confirmation_prompts : current.automation.confirmation_prompts,
  }

  const updatedTesting: TestingPreferences = {
    testing_framework: delta.testing?.testing_framework?.trim() || current.testing.testing_framework,
    table_driven_tests: typeof delta.testing?.table_driven_tests === "boolean" ? delta.testing.table_driven_tests : current.testing.table_driven_tests,
    property_based_testing: typeof delta.testing?.property_based_testing === "boolean" ? delta.testing.property_based_testing : current.testing.property_based_testing,
    mock_preference: delta.testing?.mock_preference?.trim() || current.testing.mock_preference,
    benchmark_testing: typeof delta.testing?.benchmark_testing === "boolean" ? delta.testing.benchmark_testing : current.testing.benchmark_testing,
  }

  const updatedErrorHandling: ErrorHandlingPreferences = {
    concurrency_pattern: delta.error_handling?.concurrency_pattern?.trim() || current.error_handling.concurrency_pattern,
    error_handling_pattern: delta.error_handling?.error_handling_pattern?.trim() || current.error_handling.error_handling_pattern,
    graceful_shutdown: typeof delta.error_handling?.graceful_shutdown === "boolean" ? delta.error_handling.graceful_shutdown : current.error_handling.graceful_shutdown,
    fail_fast: typeof delta.error_handling?.fail_fast === "boolean" ? delta.error_handling.fail_fast : current.error_handling.fail_fast,
  }

  const updatedTooling: ToolingPreferences = {
    preferred_package_manager: delta.tooling?.preferred_package_manager?.trim() || current.tooling.preferred_package_manager,
    prefer_cli: typeof delta.tooling?.prefer_cli === "boolean" ? delta.tooling.prefer_cli : current.tooling.prefer_cli,
    prefer_direct_edits: typeof delta.tooling?.prefer_direct_edits === "boolean" ? delta.tooling.prefer_direct_edits : current.tooling.prefer_direct_edits,
    linter_formatter: delta.tooling?.linter_formatter?.trim() || current.tooling.linter_formatter,
  }

  const updatedWorkspaceUI: WorkspaceAndUIPreferences = {
    theme_aesthetics: delta.workspace_ui?.theme_aesthetics?.trim() || current.workspace_ui.theme_aesthetics,
    output_presentation: delta.workspace_ui?.output_presentation?.trim() || current.workspace_ui.output_presentation,
    conversational_filler_tolerance: typeof delta.workspace_ui?.conversational_filler_tolerance === "number" ? clamp(delta.workspace_ui.conversational_filler_tolerance) : current.workspace_ui.conversational_filler_tolerance,
    prefer_dense_tables: typeof delta.workspace_ui?.prefer_dense_tables === "boolean" ? delta.workspace_ui.prefer_dense_tables : current.workspace_ui.prefer_dense_tables,
  }

  const updatedGitVcs: GitAndVcsPreferences = {
    branch_naming_convention: delta.git_vcs?.branch_naming_convention?.trim() || current.git_vcs.branch_naming_convention,
    commit_message_format: delta.git_vcs?.commit_message_format?.trim() || current.git_vcs.commit_message_format,
    default_branch: delta.git_vcs?.default_branch?.trim() || current.git_vcs.default_branch,
    pr_workflow: delta.git_vcs?.pr_workflow?.trim() || current.git_vcs.pr_workflow,
  }

  const updatedDocumentation: DocumentationPreferences = {
    docstring_standard: delta.documentation?.docstring_standard?.trim() || current.documentation.docstring_standard,
    comment_density: delta.documentation?.comment_density?.trim() || current.documentation.comment_density,
    in_chat_full_delivery: typeof delta.documentation?.in_chat_full_delivery === "boolean" ? delta.documentation.in_chat_full_delivery : current.documentation.in_chat_full_delivery,
    clickable_links: typeof delta.documentation?.clickable_links === "boolean" ? delta.documentation.clickable_links : current.documentation.clickable_links,
  }

  // Merge playbooks
  const existingPlaybookMap = new Map<string, DeveloperPlaybook>()
  for (const pb of current.playbooks) {
    existingPlaybookMap.set(pb.routine_name, pb)
  }
  if (delta.playbooks) {
    for (const pb of delta.playbooks) {
      const prev = existingPlaybookMap.get(pb.routine_name)
      if (prev) {
        existingPlaybookMap.set(pb.routine_name, {
          ...pb,
          frequency: prev.frequency + 1,
        })
      } else {
        existingPlaybookMap.set(pb.routine_name, pb)
      }
    }
  }

  return {
    languages: mergeUniqueList(current.languages, delta.languages),
    frameworks: mergeUniqueList(current.frameworks, delta.frameworks),
    style: updatedStyle,
    architecture: updatedArchitecture,
    security: updatedSecurity,
    automation: updatedAutomation,
    testing: updatedTesting,
    error_handling: updatedErrorHandling,
    tooling: updatedTooling,
    workspace_ui: updatedWorkspaceUI,
    git_vcs: updatedGitVcs,
    documentation: updatedDocumentation,
    playbooks: Array.from(existingPlaybookMap.values()),
    database_style: delta.database_style?.trim() || current.database_style,
  }
}

/**
 * Renders a compact, high-signal natural language summary of developer behavioral traits across all 10+ dimensions (~150 tokens).
 */
export function formatProfileDirectives(profile: UserProfileData): string {
  const parts: string[] = []

  if (profile.languages.length > 0) {
    parts.push(`- Languages & Stack: ${profile.languages.slice(0, 5).join(", ")} | Frameworks: ${profile.frameworks.slice(0, 5).join(", ")}`)
  }

  const styleParts: string[] = []
  if (profile.style.explicitness > 0.7) styleParts.push("explicit > magical")
  if (profile.style.abstraction_tolerance < 0.4) styleParts.push("flat modules (low indirection)")
  if (profile.style.inlining_preference > 0.7) styleParts.push("inline single-use variables")
  if (profile.style.typing_rigor > 0.8) styleParts.push("strict typing (no 'any')")
  if (styleParts.length > 0) parts.push(`- Code Style: ${styleParts.join("; ")}`)

  parts.push(`- Architecture & Concurrency: ${profile.architecture.paradigm} (${profile.architecture.dependency_pattern}) | ${profile.error_handling.concurrency_pattern}`)

  const securityParts: string[] = []
  if (profile.security.mask_secrets_and_ips) securityParts.push("mask internal IPs & auth tokens")
  if (profile.security.local_first_execution) securityParts.push("local-first execution")
  if (securityParts.length > 0) parts.push(`- Security & Privacy: ${securityParts.join("; ")}`)

  const autoParts: string[] = []
  if (!profile.automation.allow_browser_automation) autoParts.push("NO browser automation")
  if (!profile.automation.allow_sleep_wait_loops) autoParts.push("never sleep/wait in loops")
  if (profile.automation.auto_test_verification) autoParts.push(`verify with ${profile.testing.testing_framework}`)
  if (autoParts.length > 0) parts.push(`- Automation Guardrails: ${autoParts.join("; ")}`)

  parts.push(`- Tooling & Git: ${profile.tooling.preferred_package_manager} package manager | ${profile.git_vcs.branch_naming_convention} | ${profile.git_vcs.commit_message_format}`)

  if (profile.playbooks.length > 0) {
    const topPlaybooks = profile.playbooks.slice(0, 2).map((pb) => `${pb.routine_name}: [${pb.action_sequence.slice(0, 2).join(" -> ")}]`)
    parts.push(`- Active Playbooks: ${topPlaybooks.join(" | ")}`)
  }

  return parts.join("\n")
}
