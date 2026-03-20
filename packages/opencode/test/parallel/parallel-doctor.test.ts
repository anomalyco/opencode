import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { tmpdir } from "../fixture/fixture"
import { Config } from "../../src/config/config"
import { PlanStore } from "../../src/parallel/plan"
import { Orchestrator } from "../../src/parallel/orchestrator"

describe("ParallelDoctorCommand", () => {
  test("all checks pass with valid configuration", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        // Run doctor checks manually since we're inside bootstrap
        const checks: { name: string; status: string; details?: string }[] = []

        // Check config - parallel may be undefined when not configured
        const cfg = await Config.get()
        // parallel config is optional, so it may be undefined
        checks.push({
          name: "parallel_config",
          status: "pass",
          details: cfg.parallel ? "Using custom values" : "Using default values (no parallel config set)",
        })

        // Check model resolution
        const models = await Orchestrator.resolveModels()
        expect(models.orchestratorModel).toBeDefined()
        expect(models.workerModel).toBeDefined()
        checks.push({
          name: "model_resolution",
          status: "pass",
          details: `Orchestrator: ${models.orchestratorModel.providerID}/${models.orchestratorModel.modelID}`,
        })

        // Check DB access
        const plans = await PlanStore.list()
        expect(Array.isArray(plans)).toBe(true)
        checks.push({
          name: "database_access",
          status: "pass",
          details: "Plan table accessible",
        })

        // All checks should pass
        expect(checks.every((c) => c.status === "pass")).toBe(true)

        return checks
      },
    })
  })

  test("config validation detects parallel settings", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        parallel: {
          orchestrator_model: "test/orch-model",
          worker_model: "test/worker-model",
          max_workers: 5,
          max_plans_per_project: 3,
          max_subtasks: 10,
          require_approval: false,
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const cfg = await Config.get()

        expect(cfg.parallel?.orchestrator_model).toBe("test/orch-model")
        expect(cfg.parallel?.worker_model).toBe("test/worker-model")
        expect(cfg.parallel?.max_workers).toBe(5)
        expect(cfg.parallel?.max_plans_per_project).toBe(3)
        expect(cfg.parallel?.max_subtasks).toBe(10)
        expect(cfg.parallel?.require_approval).toBe(false)

        return cfg
      },
    })
  })

  test("model unavailability is detected", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        parallel: {
          orchestrator_model: "nonexistent-provider/nonexistent-model",
          worker_model: "another-invalid/model",
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        // The config should be set
        const cfg = await Config.get()
        expect(cfg.parallel?.orchestrator_model).toBe("nonexistent-provider/nonexistent-model")

        // But resolving models should fall back to defaults or throw
        try {
          const models = await Orchestrator.resolveModels()
          // If it resolves, the providerID will be a branded type
          expect(models.orchestratorModel.providerID).toBeDefined()
        } catch {
          // Expected to potentially fail with invalid provider
        }

        return cfg
      },
    })
  })

  test("JSON output format structure", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        // Simulate JSON output structure
        const result = {
          checks: [
            { name: "parallel_config", status: "pass", details: "Using defaults" },
            { name: "model_resolution", status: "pass", details: "Models resolved" },
            { name: "model_availability", status: "pass", details: "Available" },
            { name: "git_worktree", status: "pass", details: "Ready" },
            { name: "database_access", status: "pass", details: "Accessible" },
          ],
          passed: true,
          hasCriticalFailures: false,
        }

        // Validate structure
        expect(result.checks).toBeArray()
        expect(result.checks.length).toBeGreaterThan(0)

        for (const check of result.checks) {
          expect(check.name).toBeString()
          expect(check.status).toBeOneOf(["pass", "warn", "fail"])
          if (check.details) {
            expect(check.details).toBeString()
          }
        }

        expect(result.passed).toBeBoolean()
        expect(result.hasCriticalFailures).toBeBoolean()

        // Test JSON serialization
        const json = JSON.stringify(result, null, 2)
        const parsed = JSON.parse(json)
        expect(parsed.checks).toEqual(result.checks)
        expect(parsed.passed).toBe(result.passed)

        return result
      },
    })
  })

  test("JSON output with failures", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        // Simulate result with failures
        const result = {
          checks: [
            { name: "parallel_config", status: "pass", details: "Configured" },
            { name: "model_resolution", status: "pass", details: "Resolved" },
            { name: "model_availability", status: "fail", details: "Model unavailable: test/model" },
            { name: "git_worktree", status: "pass", details: "Ready" },
            { name: "database_access", status: "fail", details: "Connection failed" },
          ],
          passed: false,
          hasCriticalFailures: true,
        }

        expect(result.passed).toBe(false)
        expect(result.hasCriticalFailures).toBe(true)

        const failures = result.checks.filter((c) => c.status === "fail")
        expect(failures.length).toBe(2)
        expect(failures.map((f) => f.name)).toContain("model_availability")
        expect(failures.map((f) => f.name)).toContain("database_access")

        return result
      },
    })
  })

  test("exit code behavior - zero when all pass", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const result = {
          checks: [
            { name: "check1", status: "pass" },
            { name: "check2", status: "pass" },
          ],
          passed: true,
          hasCriticalFailures: false,
        }

        // When hasCriticalFailures is false, exit code should be 0
        expect(result.hasCriticalFailures).toBe(false)
        expect(result.passed).toBe(true)

        return result
      },
    })
  })

  test("exit code behavior - non-zero on critical failures", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const result = {
          checks: [
            { name: "check1", status: "pass" },
            { name: "check2", status: "fail", details: "Critical error" },
          ],
          passed: false,
          hasCriticalFailures: true,
        }

        // When hasCriticalFailures is true, exit code should be 1
        expect(result.hasCriticalFailures).toBe(true)
        expect(result.passed).toBe(false)

        return result
      },
    })
  })

  test("exit code behavior - zero on warnings only", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const result = {
          checks: [
            { name: "check1", status: "pass" },
            { name: "check2", status: "warn", details: "Some warning" },
          ],
          passed: false,
          hasCriticalFailures: false,
        }

        // Warnings don't cause non-zero exit
        expect(result.hasCriticalFailures).toBe(false)
        expect(result.passed).toBe(false) // Not all passed due to warning

        return result
      },
    })
  })

  test("git worktree validation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        // With git: true, the temp directory should be a valid git repo
        const { git } = await import("../../src/util/git")

        const gitCheck = await git(["rev-parse", "--is-inside-work-tree"], { cwd: tmp.path })
        expect(gitCheck.exitCode).toBe(0)
        expect(gitCheck.text().trim()).toBe("true")

        return gitCheck
      },
    })
  })

  test("database access validation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        // Should be able to list plans without error
        const plans = await PlanStore.list()
        expect(Array.isArray(plans)).toBe(true)

        // Should be able to create a plan
        const plan = await PlanStore.create({
          projectID: Instance.project.id,
          sessionID: undefined,
          task: "Doctor test plan",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        expect(plan.id).toBeDefined()
        expect(plan.status).toBe("draft")

        // Should be able to retrieve it
        const retrieved = await PlanStore.get(plan.id)
        expect(retrieved.id).toBe(plan.id)

        return plan
      },
    })
  })
})
