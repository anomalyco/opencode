import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { Orchestrator } from "../../parallel/orchestrator"
import { PlanStore } from "../../parallel/plan"
import { git } from "../../util/git"
import { Instance } from "../../project/instance"
import { access } from "fs/promises"
import { constants } from "fs"

type CheckStatus = "pass" | "warn" | "fail"

interface Check {
  name: string
  status: CheckStatus
  details?: string
}

interface DoctorResult {
  checks: Check[]
  passed: boolean
  hasCriticalFailures: boolean
}

async function runChecks(): Promise<DoctorResult> {
  const checks: Check[] = []
  let hasCriticalFailures = false

  // Check 1: Parallel config values
  try {
    const cfg = await Config.get()
    const parallel = cfg.parallel ?? {}

    const configFields = [
      { name: "orchestrator_model", value: parallel.orchestrator_model },
      { name: "worker_model", value: parallel.worker_model },
      { name: "max_workers", value: parallel.max_workers },
      { name: "max_plans_per_project", value: parallel.max_plans_per_project },
      { name: "max_subtasks", value: parallel.max_subtasks },
      { name: "require_approval", value: parallel.require_approval },
    ]

    const configured = configFields.filter((f) => f.value !== undefined)

    if (configured.length === 0) {
      checks.push({
        name: "parallel_config",
        status: "pass",
        details: "Using default values (no parallel config set)",
      })
    } else {
      const details = configured.map((f) => `${f.name}: ${f.value}`).join(", ")
      checks.push({
        name: "parallel_config",
        status: "pass",
        details: `Configured: ${details}`,
      })
    }
  } catch (err) {
    checks.push({
      name: "parallel_config",
      status: "fail",
      details: err instanceof Error ? err.message : "Failed to read config",
    })
    hasCriticalFailures = true
  }

  // Check 2: Model resolution using Orchestrator.resolveModels()
  try {
    const models = await Orchestrator.resolveModels()
    checks.push({
      name: "model_resolution",
      status: "pass",
      details: `Orchestrator: ${models.orchestratorModel.providerID}/${models.orchestratorModel.modelID}, Worker: ${models.workerModel.providerID}/${models.workerModel.modelID}`,
    })
  } catch (err) {
    checks.push({
      name: "model_resolution",
      status: "fail",
      details: err instanceof Error ? err.message : "Failed to resolve models",
    })
    hasCriticalFailures = true
  }

  // Check 3: Provider and model availability
  try {
    const models = await Orchestrator.resolveModels()
    const modelChecks = [
      { name: "orchestrator", ref: models.orchestratorModel },
      { name: "worker", ref: models.workerModel },
    ]

    const unavailable: string[] = []

    for (const { name, ref } of modelChecks) {
      try {
        await Provider.getModel(ref.providerID, ref.modelID)
      } catch {
        unavailable.push(`${name} (${ref.providerID}/${ref.modelID})`)
      }
    }

    if (unavailable.length === 0) {
      checks.push({
        name: "model_availability",
        status: "pass",
        details: "All models are available",
      })
    } else {
      checks.push({
        name: "model_availability",
        status: "fail",
        details: `Unavailable: ${unavailable.join(", ")}`,
      })
      hasCriticalFailures = true
    }
  } catch (err) {
    checks.push({
      name: "model_availability",
      status: "fail",
      details: err instanceof Error ? err.message : "Failed to check model availability",
    })
    hasCriticalFailures = true
  }

  // Check 4: Git and worktree readiness
  try {
    const root = Instance.worktree ?? process.cwd()

    // Check git worktree
    const gitCheck = await git(["rev-parse", "--is-inside-work-tree"], { cwd: root })

    if (gitCheck.exitCode !== 0) {
      checks.push({
        name: "git_worktree",
        status: "fail",
        details: `Not inside a git worktree: ${gitCheck.text() || gitCheck.stderr.toString()}`,
      })
      hasCriticalFailures = true
    } else {
      // Check directory is writable
      const writable = await access(root, constants.W_OK)
        .then(() => true)
        .catch(() => false)

      if (!writable) {
        checks.push({
          name: "git_worktree",
          status: "fail",
          details: `Worktree is not writable: ${root}`,
        })
        hasCriticalFailures = true
      } else {
        checks.push({
          name: "git_worktree",
          status: "pass",
          details: `Git worktree ready at ${root}`,
        })
      }
    }
  } catch (err) {
    checks.push({
      name: "git_worktree",
      status: "fail",
      details: err instanceof Error ? err.message : "Git worktree check failed",
    })
    hasCriticalFailures = true
  }

  // Check 5: DB access for plan table
  try {
    // Try to list plans as a simple DB query
    await PlanStore.list()
    checks.push({
      name: "database_access",
      status: "pass",
      details: "Plan table accessible",
    })
  } catch (err) {
    checks.push({
      name: "database_access",
      status: "fail",
      details: err instanceof Error ? err.message : "Database access failed",
    })
    hasCriticalFailures = true
  }

  const passed = checks.every((c) => c.status === "pass")

  return { checks, passed, hasCriticalFailures }
}

function formatHumanReadable(result: DoctorResult): string {
  const lines: string[] = []

  lines.push("")
  lines.push(UI.Style.TEXT_NORMAL_BOLD + "Parallel Doctor" + UI.Style.TEXT_NORMAL)
  lines.push("")

  for (const check of result.checks) {
    const symbol =
      check.status === "pass"
        ? UI.Style.TEXT_SUCCESS + "✓" + UI.Style.TEXT_NORMAL
        : check.status === "warn"
          ? UI.Style.TEXT_WARNING + "⚠" + UI.Style.TEXT_NORMAL
          : UI.Style.TEXT_DANGER + "✗" + UI.Style.TEXT_NORMAL

    const name = check.name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
    lines.push(`${symbol} ${name}`)

    if (check.details) {
      const indented = check.details
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n")
      lines.push(UI.Style.TEXT_DIM + indented + UI.Style.TEXT_NORMAL)
    }
    lines.push("")
  }

  if (result.passed) {
    lines.push(UI.Style.TEXT_SUCCESS_BOLD + "All checks passed!" + UI.Style.TEXT_NORMAL)
  } else if (result.hasCriticalFailures) {
    lines.push(UI.Style.TEXT_DANGER_BOLD + "Some checks failed. Please fix the issues above." + UI.Style.TEXT_NORMAL)
  } else {
    lines.push(UI.Style.TEXT_WARNING_BOLD + "Some checks have warnings." + UI.Style.TEXT_NORMAL)
  }

  return lines.join("\n")
}

export const ParallelDoctorCommand = cmd({
  command: "doctor",
  describe: "Run diagnostics on parallel agents configuration",
  builder: (yargs: Argv) => {
    return yargs.option("json", {
      describe: "Output as JSON",
      type: "boolean",
      default: false,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await runChecks()

      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        UI.println(formatHumanReadable(result))
      }

      // Exit non-zero only on critical failures
      if (result.hasCriticalFailures) {
        process.exit(1)
      }
    })
  },
})
