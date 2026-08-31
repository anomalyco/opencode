import { describe, expect, it } from "bun:test"
import { DEFAULT_USER_PROFILE, applyProfileDrift, formatProfileDirectives } from "../src/profile"

describe("Profile Module", () => {
  it("should have expected default user profile values", () => {
    expect(DEFAULT_USER_PROFILE.languages).toContain("typescript")
    expect(DEFAULT_USER_PROFILE.languages).toContain("go")
    expect(DEFAULT_USER_PROFILE.style.explicitness).toBeGreaterThan(0.5)
    expect(DEFAULT_USER_PROFILE.style.typing_rigor).toBeGreaterThan(0.8)
    expect(DEFAULT_USER_PROFILE.security.mask_secrets_and_ips).toBe(true)
    expect(DEFAULT_USER_PROFILE.automation.allow_browser_automation).toBe(false)
    expect(DEFAULT_USER_PROFILE.playbooks.length).toBeGreaterThan(0)
  })

  it("should apply dynamic profile drift using EMA across all dimensions", () => {
    const initial = { ...DEFAULT_USER_PROFILE }
    const updated = applyProfileDrift(
      initial,
      {
        style: {
          explicitness: 0.98,
          abstraction_tolerance: 0.1,
          verbosity: 0.1,
        },
        languages: ["rust", "elixir"],
        security: {
          mask_secrets_and_ips: true,
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
    expect(updated.style.explicitness).toBeGreaterThanOrEqual(initial.style.explicitness)
    expect(updated.style.abstraction_tolerance).toBeLessThan(initial.style.abstraction_tolerance)
    expect(updated.style.verbosity).toBeLessThan(initial.style.verbosity)

    // Check language deduplication & insertion
    expect(updated.languages).toContain("rust")
    expect(updated.languages).toContain("elixir")
    expect(updated.languages).toContain("typescript")

    // Check playbook addition
    expect(updated.playbooks.some((pb) => pb.routine_name === "deploy_service")).toBe(true)
  })

  it("should format high-signal profile directives across all 10+ dimensions", () => {
    const directives = formatProfileDirectives(DEFAULT_USER_PROFILE)
    expect(directives).toContain("Languages & Stack")
    expect(directives).toContain("Code Style")
    expect(directives).toContain("Architecture & Concurrency")
    expect(directives).toContain("Security & Privacy")
    expect(directives).toContain("Automation Guardrails")
    expect(directives).toContain("Active Playbooks")
  })
})
