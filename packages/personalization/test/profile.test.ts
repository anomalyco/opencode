import { describe, expect, it } from "bun:test"
import { DEFAULT_USER_PROFILE, applyProfileDrift, formatProfileDirectives } from "../src/profile"

describe("Profile Module", () => {
  it("should have clean neutral cold-start default user profile values", () => {
    expect(DEFAULT_USER_PROFILE.languages).toHaveLength(0)
    expect(DEFAULT_USER_PROFILE.frameworks).toHaveLength(0)
    expect(DEFAULT_USER_PROFILE.style.explicitness).toBe(0.5)
    expect(DEFAULT_USER_PROFILE.style.typing_rigor).toBe(0.5)
    expect(DEFAULT_USER_PROFILE.security.mask_secrets_and_ips).toBe(true)
    expect(DEFAULT_USER_PROFILE.automation.allow_browser_automation).toBe(false)
    expect(DEFAULT_USER_PROFILE.playbooks).toHaveLength(0) // Clean start: no hardcoded fake playbooks
  })

  it("should dynamically learn and drift profile across all dimensions from developer interaction", () => {
    const initial = { ...DEFAULT_USER_PROFILE }
    const updated = applyProfileDrift(
      initial,
      {
        style: {
          explicitness: 0.95,
          abstraction_tolerance: 0.2,
          verbosity: 0.1,
          typing_rigor: 0.9,
          inlining_preference: 0.85,
        },
        languages: ["typescript", "go"],
        frameworks: ["effect", "react"],
        architecture: {
          paradigm: "functional_composable",
          dependency_pattern: "effect_layers",
        },
        security: {
          mask_secrets_and_ips: true,
          local_first_execution: true,
        },
        automation: {
          auto_test_verification: true,
        },
        testing: {
          testing_framework: "vitest",
        },
        tooling: {
          preferred_package_manager: "bun",
        },
        git_vcs: {
          branch_naming_convention: "max_3_words_kebab_case_no_slashes",
          commit_message_format: "conventional_commits_type_scope_summary",
        },
        playbooks: [
          {
            routine_name: "deploy_service",
            trigger_pattern: "When deploying production service",
            action_sequence: ["Build bundle", "Run health checks", "Deploy canary"],
            preferred_commands: ["bun run build", "docker compose up -d"],
            frequency: 1,
          },
        ],
      },
      0.5,
    )

    // Check EMA numeric update
    expect(updated.style.explicitness).toBeGreaterThan(initial.style.explicitness)
    expect(updated.style.abstraction_tolerance).toBeLessThan(initial.style.abstraction_tolerance)
    expect(updated.style.verbosity).toBeLessThan(initial.style.verbosity)

    // Check dynamically learned languages & frameworks
    expect(updated.languages).toContain("typescript")
    expect(updated.languages).toContain("go")
    expect(updated.frameworks).toContain("effect")

    // Check learned playbook
    expect(updated.playbooks.some((pb) => pb.routine_name === "deploy_service")).toBe(true)

    // Check directives formatting on dynamically learned profile
    const directives = formatProfileDirectives(updated)
    expect(directives).toContain("Languages & Stack: typescript, go")
    expect(directives).toContain("Code Style")
    expect(directives).toContain("Security & Privacy")
    expect(directives).toContain("Active Playbooks: deploy_service")
  })
})
