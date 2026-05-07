/**
 * SWE-bench bench CLI driver.
 *
 * Drives a single SWE-bench instance to completion using opencode's REAL
 * agentic loop. We spawn `bun .../src/index.ts run` as a subprocess (with a
 * per-instance opencode config that registers our `nemo-gym` provider, a
 * SWE-bench agent, and disables compaction) and let it run to idle.
 *
 * Why subprocess instead of in-process Server.Default? Subprocess is the
 * model the user-facing `opencode run` already uses (cli/cmd/run.ts:670–675
 * also uses an in-process fetch but the public entry is `bun .../index.ts`).
 * A subprocess gives us:
 *   - clean process isolation per instance (matters for many parallel SIFs)
 *   - identical bootstrapping path to `opencode run`, so we don't drift
 *   - the JSON event stream on stdout for free (--format json)
 *
 * Trajectory capture: the nemo-gym provider (registered via this config)
 * writes `<completionsDir>/<turn>.json` per LLM call BEFORE returning. On
 * exit we capture `git diff` and write `output.jsonl`.
 */

import { promises as fs, readFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawn } from "node:child_process"

interface CliArgs {
  instanceDictPath: string
  outputDir: string
  config: string
  maxTurns: number
  agentCls: string
  dataset: string
  split: string
  selectedId: string
  /** Resolved repo path inside the SIF — gym side decided based on dataset_name. */
  workspaceRoot: string
  /** Pre-rendered user message file (workspace_path baked in by gym). */
  userMessageFile: string
  systemPromptPath?: string
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = { maxTurns: 100, agentCls: "OpenCodeAgent", dataset: "", split: "test" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case "--instance-dict-path":
        out.instanceDictPath = next()
        break
      case "--output-dir":
        out.outputDir = next()
        break
      case "--config":
        out.config = next()
        break
      case "--max-turns":
        out.maxTurns = parseInt(next(), 10)
        break
      case "--agent-cls":
        out.agentCls = next()
        break
      case "--dataset":
        out.dataset = next()
        break
      case "--split":
        out.split = next()
        break
      case "--selected-id":
        out.selectedId = next()
        break
      case "--workspace-root":
        out.workspaceRoot = next()
        break
      case "--user-message-file":
        out.userMessageFile = next()
        break
      case "--system-prompt":
        out.systemPromptPath = next()
        break
      default:
        if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`)
    }
  }
  for (const required of [
    "instanceDictPath",
    "outputDir",
    "config",
    "selectedId",
    "workspaceRoot",
    "userMessageFile",
  ] as const) {
    if (!out[required])
      throw new Error(`Missing required arg --${required.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`)
  }
  return out as CliArgs
}

interface InstanceDict {
  instance_id: string
  problem_statement: string
  repo?: string
  repo_name?: string
  workspace?: string
  [key: string]: unknown
}

async function readInstance(instanceDictPath: string, selectedId: string): Promise<InstanceDict> {
  const text = await fs.readFile(instanceDictPath, "utf8")
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const records = lines.map((l) => JSON.parse(l) as InstanceDict)
  const match = records.find((r) => r.instance_id === selectedId) ?? records[0]
  if (!match) throw new Error(`No instance found in ${instanceDictPath}`)
  return match
}

function loadGymConfig(configPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath, "utf8"))
}

const DEFAULT_SYSTEM_PROMPT = `You are an autonomous software engineer fixing a known issue in a checked-out git repository.

Work in small, deliberate steps:
1. Read the issue and explore the relevant files.
2. Reproduce the issue if applicable.
3. Edit the source to fix the issue.
4. Run the project's tests to verify the fix.
5. Iterate until the issue is resolved.

Use the available tools (bash, edit, read, glob, grep) to investigate and act. Do NOT modify the test files unless the task explicitly says so. The harness will capture the final \`git diff\` of the workspace as your patch — do not commit or format the diff yourself.
`

async function buildConfigDir(args: {
  instanceId: string
  modelName: string
  baseURL: string
  completionsDir: string
  maxTurns: number
  systemPromptPath?: string
}): Promise<{ tmpRoot: string; configFile: string }> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `bench-${args.instanceId}-`))
  await fs.mkdir(tmpRoot, { recursive: true })

  const systemPrompt = args.systemPromptPath
    ? await fs.readFile(args.systemPromptPath, "utf8")
    : DEFAULT_SYSTEM_PROMPT

  const cfg: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      "nemo-gym": {
        npm: "@opencode-ai/nemo-gym",
        options: {
          baseURL: args.baseURL,
          completionsDir: args.completionsDir,
          instanceId: args.instanceId,
        },
        models: {
          [args.modelName]: {
            id: args.modelName,
            name: args.modelName,
            limit: { context: 131072, output: 32768 },
            tool_call: true,
            temperature: true,
          },
        },
      },
    },
    agent: {
      "swe-bench": {
        mode: "primary",
        model: `nemo-gym/${args.modelName}`,
        prompt: systemPrompt,
        // Allow the read+write tool set; disable web/skill/task to keep the
        // agent focused on local code editing.
        permission: {
          edit: { "**": "allow" },
          bash: { "*": "allow" },
          webfetch: { "*": "deny" },
          websearch: { "*": "deny" },
        },
        tools: {
          bash: true,
          edit: true,
          read: true,
          glob: true,
          grep: true,
          write: true,
          apply_patch: true,
          webfetch: false,
          websearch: false,
          task: false,
          skill: false,
          todowrite: false,
        },
        steps: args.maxTurns,
        options: {},
      },
    },
    compaction: { auto: false },
    share: "manual",
  }

  const configFile = path.join(tmpRoot, "opencode.jsonc")
  await fs.writeFile(configFile, JSON.stringify(cfg, null, 2))

  return { tmpRoot, configFile }
}

function runOpencode(args: {
  workspaceRoot: string
  modelName: string
  message: string
  env: NodeJS.ProcessEnv
  opencodeBin: string
  agent: string
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      [
        args.opencodeBin,
        "run",
        args.message,
        "--agent",
        args.agent,
        "--model",
        `nemo-gym/${args.modelName}`,
        "--format",
        "json",
        "--dangerously-skip-permissions",
        "--dir",
        args.workspaceRoot,
      ],
      {
        cwd: args.workspaceRoot,
        env: args.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (b) => {
      const chunk = b.toString("utf8")
      stdout += chunk
      // Forward to our stdout so the gym log captures the event stream.
      process.stdout.write(chunk)
    })
    child.stderr?.on("data", (b) => {
      const chunk = b.toString("utf8")
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.on("close", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }))
    child.on("error", (err) => {
      stderr += String(err)
      resolve({ exitCode: 999, stdout, stderr })
    })
  })
}

async function captureGitDiff(workspaceRoot: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", workspaceRoot, "diff"], {
      env: { ...process.env, GIT_PAGER: "cat" },
    })
    let stdout = ""
    child.stdout?.on("data", (b) => (stdout += b.toString("utf8")))
    child.on("close", () => resolve(stdout))
    child.on("error", () => resolve(""))
  })
}

interface OutputJsonl {
  instance_id: string
  test_result: { git_patch: string }
  metadata: { llm_config: { model: string } }
  metrics: Record<string, unknown>
  error: string | null
}

async function writeOutputJsonl(evalOutputDir: string, instanceId: string, payload: OutputJsonl): Promise<string> {
  const runDir = path.join(evalOutputDir, instanceId, "bench_run")
  await fs.mkdir(runDir, { recursive: true })
  const outPath = path.join(runDir, "output.jsonl")
  const tmp = `${outPath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(payload) + "\n")
  await fs.rename(tmp, outPath)
  return outPath
}

function completionsDirFor(evalOutputDir: string, instanceId: string): string {
  // Match openhands' on-host glob: <eval_dir>/*/*/*/llm_completions/<instance_id>/*.json
  return path.join(evalOutputDir, instanceId, "bench_run", "llm_completions", instanceId)
}

function detectOpencodeBin(): string {
  // bench/cli.ts runs from packages/opencode/src/bench/. The opencode index
  // entry sits at packages/opencode/src/index.ts. From this script's url we
  // resolve up two levels.
  const here = path.dirname(new URL(import.meta.url).pathname)
  return path.resolve(here, "..", "index.ts")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const instance = await readInstance(args.instanceDictPath, args.selectedId)
  // workspaceRoot is decided gym-side based on dataset_name; we use it verbatim.
  const workspaceRoot = args.workspaceRoot
  const gymConfig = loadGymConfig(args.config)
  const llmModelCfg = ((gymConfig as Record<string, Record<string, unknown>>).llm?.model ?? {}) as Record<
    string,
    unknown
  >
  const modelName = String(llmModelCfg.model ?? "unknown-model")
  const baseURL = process.env.NEMO_GYM_MODEL_SERVER_BASE_URL
  if (!baseURL) throw new Error("NEMO_GYM_MODEL_SERVER_BASE_URL not set in env (gym harness sets this).")

  const completionsDir = completionsDirFor(args.outputDir, instance.instance_id)
  await fs.mkdir(completionsDir, { recursive: true })

  // The user message is fully rendered by gym (workspace_path baked in based
  // on dataset_name); we just read it as-is and pass it to opencode.
  const userPrompt = await fs.readFile(args.userMessageFile, "utf8")

  const { tmpRoot, configFile } = await buildConfigDir({
    instanceId: instance.instance_id,
    modelName,
    baseURL,
    completionsDir,
    maxTurns: args.maxTurns,
    systemPromptPath: args.systemPromptPath,
  })

  const startedAt = Date.now()
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // Run-isolated opencode state.
    OPENCODE_DB: ":memory:",
    OPENCODE_DATA: path.join(tmpRoot, "data"),
    OPENCODE_CONFIG: configFile,
    // Disable opencode's built-in plugin loaders; the bench harness doesn't need them.
    OPENCODE_PURE: "1",
  }

  const opencodeBin = detectOpencodeBin()
  const result = await runOpencode({
    workspaceRoot,
    modelName,
    message: userPrompt,
    env: childEnv,
    opencodeBin,
    agent: "swe-bench",
  })

  const patch = await captureGitDiff(workspaceRoot)
  const benchRunTime = (Date.now() - startedAt) / 1000

  const error: string | null = result.exitCode === 0 ? null : `opencode_exit_${result.exitCode}`
  const outPath = await writeOutputJsonl(args.outputDir, instance.instance_id, {
    instance_id: instance.instance_id,
    test_result: { git_patch: patch },
    metadata: { llm_config: { model: modelName } },
    metrics: {
      bench_run_time: benchRunTime,
      opencode_exit_code: result.exitCode,
    },
    error,
  })

  console.log(`[bench] wrote ${outPath} (patch=${patch.length} bytes, error=${error ?? "none"})`)

  if (result.exitCode !== 0) process.exit(1)
}

main().catch((err) => {
  console.error(`[bench] fatal: ${err?.stack ?? err}`)
  process.exit(2)
})
