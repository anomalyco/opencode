import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { base64Encode } from "@opencode/util/encode"
import { expect, type Locator, type Page } from "@playwright/test"
import type { ReportCommand, RunSnapshot, Task, TaskDefinition } from "@bearmanser/opencode-superpowers-execution/contract"

export const MANAGED_SERVICE_PORT = 4096
export const APP_DEV_PORT = 3000
const LOOPBACK_HOST = "127.0.0.1"

export type ExecutionTestTarget = {
  readonly disposable: true
  readonly directory: string
  readonly port: number
  readonly host: string
  readonly password: string
  readonly executable: string
}

export type ExecutionHostManifest = {
  readonly disposable: true
  readonly executable: string
  readonly script: string
  readonly host: string
  readonly port: number
  readonly serverURL: string
  readonly pid: number
  readonly process: ChildProcess
  readonly directories: {
    readonly root: string
    readonly owner: string
    readonly worktree: string
    readonly data: string
    readonly logs: string
  }
}

export type ExecutionHarnessResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly detail: string } }

export type ExecutionRunRef = {
  readonly runID: string
  readonly rootSessionID: string
}

export const EXECUTION_ROOT_SESSION = "ses_exec_root"
export const EXECUTION_CHILD_SESSION = "ses_exec_child"
export const EXECUTION_REVIEWER_SESSION = "ses_exec_reviewer"
export const EXECUTION_STRANGER_SESSION = "ses_exec_stranger"
export const EXECUTION_STRANGER_CHILD_SESSION = "ses_exec_stranger_child"
export const EXECUTION_RUN_ID = "run-exec-1"

export const executionTaskDefinitions: readonly TaskDefinition[] = [
  {
    id: "schema",
    title: "Schema",
    phase: "Phase 1",
    order: 0,
    dependsOn: [],
    requiredGates: ["tests"],
    finalReview: false,
  },
  {
    id: "api",
    title: "API",
    phase: "Phase 1",
    order: 1,
    dependsOn: ["schema"],
    requiredGates: ["tests", "spec_review"],
    finalReview: false,
  },
  {
    id: "review",
    title: "Final review",
    phase: "Phase 2",
    order: 2,
    dependsOn: ["api"],
    requiredGates: ["spec_review", "code_review"],
    finalReview: true,
  },
]

const PLAN = { path: "docs/plan.md", sha256: "0".repeat(64) }

export function requireExplicitTestTarget(raw: string | undefined): ExecutionTestTarget | undefined {
  if (raw === undefined || raw.trim() === "") return undefined
  const parsed = parseTarget(raw)
  if (parsed.disposable !== true) {
    throw new Error("Execution E2E requires an explicitly disposable target: set \"disposable\": true")
  }
  const directory = requireOwnedDirectory(parsed.directory)
  const port = requireDisposablePort(parsed.port)
  const host = typeof parsed.host === "string" && parsed.host !== "" ? parsed.host : LOOPBACK_HOST
  if (host !== LOOPBACK_HOST && host !== "localhost") {
    throw new Error(`Execution E2E requires a loopback disposable host, received ${host}`)
  }
  const executable =
    typeof parsed.executable === "string" && parsed.executable !== ""
      ? parsed.executable
      : process.versions.bun
        ? process.execPath
        : "bun"
  const password = typeof parsed.password === "string" && parsed.password !== "" ? parsed.password : crypto.randomUUID()
  return { disposable: true, directory, port, host, password, executable }
}

function parseTarget(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`EXECUTION_E2E_TARGET must be a JSON object: ${(error as Error).message}`)
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("EXECUTION_E2E_TARGET must be a JSON object")
  }
  return value as Record<string, unknown>
}

function requireOwnedDirectory(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Execution E2E requires an explicit owned temporary directory; refusing an implicit production path")
  }
  if (!path.isAbsolute(value)) {
    throw new Error("Execution E2E requires an absolute owned temporary directory")
  }
  const resolved = path.resolve(value)
  const temporaryRoot = path.resolve(os.tmpdir())
  if (resolved !== temporaryRoot && !resolved.startsWith(`${temporaryRoot}${path.sep}`)) {
    throw new Error(`Execution E2E requires an owned directory under ${temporaryRoot}, received ${resolved}`)
  }
  for (const forbidden of [path.parse(resolved).root, os.homedir(), process.cwd(), path.resolve(process.cwd(), "..")]) {
    if (resolved === forbidden) throw new Error(`Execution E2E refuses to own ${resolved}`)
  }
  return resolved
}

function requireDisposablePort(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("Execution E2E requires an explicit disposable port; refusing an implicit default")
  }
  if (value < 1024 || value > 65535) throw new Error(`Execution E2E requires a port in 1024-65535, received ${value}`)
  if (value === MANAGED_SERVICE_PORT) {
    throw new Error(`Execution E2E refuses the managed service port ${MANAGED_SERVICE_PORT}`)
  }
  if (value === APP_DEV_PORT) throw new Error(`Execution E2E refuses the app development port ${APP_DEV_PORT}`)
  return value
}

const hostScript = fileURLToPath(new URL("./disposable-host.ts", import.meta.url))

export function createExecutionTestHarness(target: ExecutionTestTarget) {
  return new ExecutionTestHarness(target)
}

export class ExecutionTestHarness {
  readonly target: ExecutionTestTarget
  private manifest: ExecutionHostManifest | undefined
  private stdout = ""
  private stderr = ""

  constructor(target: ExecutionTestTarget) {
    this.target = target
  }

  get owned() {
    if (this.manifest === undefined) throw new Error("execution test host is not running")
    return this.manifest
  }

  get serverURL() {
    return this.owned.serverURL
  }

  child(): ChildProcess {
    return this.owned.process
  }

  pid() {
    return this.owned.pid
  }

  logs() {
    return `${this.stdout}${this.stderr}`
  }

  sessionHref(rootSessionID: string) {
    return `/server/${base64Encode(this.serverURL)}/session/${rootSessionID}`
  }

  authQuery() {
    return `?auth_token=${base64Encode(`opencode:${this.target.password}`)}`
  }

  async start() {
    await mkdir(this.target.directory, { recursive: true })
    const root = await mkdtemp(path.join(this.target.directory, "execution-e2e-"))
    const directories = {
      root,
      owner: path.join(root, "owner"),
      worktree: path.join(root, "worktrees", "feature"),
      data: path.join(root, "data"),
      logs: path.join(root, "logs"),
    }
    await Promise.all([directories.owner, directories.worktree, directories.data, directories.logs].map((dir) => mkdir(dir, { recursive: true })))
    this.manifest = {
      disposable: true,
      executable: this.target.executable,
      script: hostScript,
      host: this.target.host,
      port: this.target.port,
      serverURL: `http://${this.target.host}:${this.target.port}`,
      pid: 0,
      process: spawnHost(this.target, hostScript, directories, (chunk, stream) => {
        if (stream === "stdout") this.stdout += chunk
        else this.stderr += chunk
      }),
      directories,
    }
    this.manifest = { ...this.manifest, pid: this.manifest.process.pid ?? 0 }
    await this.waitForReady()
    await this.writeLogs()
    return this.manifest
  }

  private sessions() {
    return defaultSessions(this.owned.directories.owner, this.owned.directories.worktree)
  }

  private async waitForReady() {
    const deadline = Date.now() + 30_000
    for (;;) {
      try {
        const response = await fetch(`${this.serverURL}/__test/health`, { headers: this.authHeaders() })
        if (response.ok) {
          const body = (await response.json()) as { ok?: boolean }
          if (body.ok === true) return
        }
      } catch {}
      if (Date.now() > deadline) {
        throw new Error(`disposable execution host did not become ready: ${this.logs()}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  private authHeaders() {
    return { authorization: `Basic ${base64Encode(`opencode:${this.target.password}`)}` }
  }

  private async control<T>(action: string, payload: Record<string, unknown> = {}) {
    const response = await fetch(`${this.serverURL}/__test/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`execution host control ${action} failed: ${response.status}`)
    return (await response.json()) as T
  }

  async rpc<T>(method: string, input: unknown): Promise<T> {
    const response = await fetch(`${this.serverURL}/api/rpc/superpowers.execution.v1/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ input }),
    })
    const body = (await response.json()) as { output?: T; _tag?: string; data?: unknown }
    return (response.ok ? body.output : body) as T
  }

  async native(pathname: string) {
    const response = await fetch(`${this.serverURL}${pathname}`, { headers: this.authHeaders() })
    return { status: response.status, body: await response.json() }
  }

  async setSessions(sessions: readonly unknown[]) {
    await this.control("sessions", { sessions })
  }

  async resetSessions() {
    await this.control("sessions", { sessions: this.sessions() })
  }

  async reset() {
    await this.control("reset")
  }

  async report<T = { run: RunSnapshot; appliedRevision: number; duplicate: boolean }>(
    command: ReportCommand,
    sessionID = EXECUTION_ROOT_SESSION,
  ) {
    return this.control<ExecutionHarnessResult<T>>("report", { sessionID, command })
  }

  async reportRaw<T = { run: RunSnapshot; appliedRevision: number; duplicate: boolean }>(command: unknown, sessionID = EXECUTION_ROOT_SESSION) {
    return this.control<ExecutionHarnessResult<T>>("report", { sessionID, command })
  }

  async read(runID?: string, sessionID = EXECUTION_ROOT_SESSION) {
    return this.control<ExecutionHarnessResult<{ run: RunSnapshot | null }>>("read", {
      sessionID,
      input: runID === undefined ? {} : { runID },
    })
  }

  async readRun(runID: string, sessionID = EXECUTION_ROOT_SESSION) {
    const result = await this.read(runID, sessionID)
    if (!result.ok) throw new Error(`execution_read failed: ${result.error.detail}`)
    if (result.value.run === null) throw new Error(`run ${runID} was not found`)
    return result.value.run
  }

  async startRun(overrides: { runID?: string; rootSessionID?: string } = {}): Promise<ExecutionRunRef> {
    const runID = overrides.runID ?? EXECUTION_RUN_ID
    const rootSessionID = overrides.rootSessionID ?? EXECUTION_ROOT_SESSION
    const result = await this.report(
      {
        operationID: `start-${runID}`,
        runID,
        expectedRevision: 0,
        operation: { type: "run.start", title: "Execution run", plan: PLAN, tasks: [...executionTaskDefinitions] },
      },
      rootSessionID,
    )
    if (!result.ok) throw new Error(`run.start failed: ${result.error.detail}`)
    return { runID, rootSessionID }
  }

  async reportTaskState(
    run: ExecutionRunRef,
    taskID: string,
    state: "running" | "blocked" | "awaiting_review" | "failed",
    reason?: string,
  ) {
    const current = await this.readRun(run.runID, run.rootSessionID)
    const task = taskFor(current, taskID)
    const result = await this.report(
      {
        operationID: `state-${taskID}-${task.attempt}-${state}-${current.revision}`,
        runID: run.runID,
        expectedRevision: current.revision,
        operation: { type: "task.state", taskID, attempt: task.attempt, state, ...(reason === undefined ? {} : { reason }) },
      },
      run.rootSessionID,
    )
    if (!result.ok) throw new Error(`task.state failed: ${result.error.detail}`)
    return result.value
  }

  async addGateEvidence(run: ExecutionRunRef, taskID: string, gate: Task["requiredGates"][number], sessionID = EXECUTION_CHILD_SESSION) {
    const current = await this.readRun(run.runID, run.rootSessionID)
    const task = taskFor(current, taskID)
    const result = await this.report(
      {
        operationID: `evidence-${taskID}-${gate}-${current.revision}`,
        runID: run.runID,
        expectedRevision: current.revision,
        operation: {
          type: "evidence.add",
          id: `ev-${taskID}-${gate}`,
          taskID,
          attempt: task.attempt,
          gate,
          outcome: "passed",
          summary: `${gate} passed`,
          sessionID,
          messageID: `msg-${taskID}-${gate}`,
        },
      },
      run.rootSessionID,
    )
    if (!result.ok) throw new Error(`evidence.add failed: ${result.error.detail}`)
    return result.value
  }

  async reportVerifiedTask(run: ExecutionRunRef, taskID: string) {
    const start = await this.readRun(run.runID, run.rootSessionID)
    const task = taskFor(start, taskID)
    if (task.state === "pending" || task.state === "blocked") await this.reportTaskState(run, taskID, "running")
    const current = await this.readRun(run.runID, run.rootSessionID)
    const attempt = taskFor(current, taskID).attempt
    for (const gate of taskFor(current, taskID).requiredGates) {
      await this.addGateEvidence(run, taskID, gate)
    }
    const latest = await this.readRun(run.runID, run.rootSessionID)
    const result = await this.report(
      {
        operationID: `verify-${taskID}-${latest.revision}`,
        runID: run.runID,
        expectedRevision: latest.revision,
        operation: { type: "task.verify", taskID, attempt },
      },
      run.rootSessionID,
    )
    if (!result.ok) throw new Error(`task.verify failed: ${result.error.detail}`)
    return result.value
  }

  async cancelRun(run: ExecutionRunRef, reason = "user cancelled") {
    const current = await this.readRun(run.runID, run.rootSessionID)
    const result = await this.report(
      {
        operationID: `cancel-${run.runID}-${current.revision}`,
        runID: run.runID,
        expectedRevision: current.revision,
        operation: { type: "run.cancel", reason },
      },
      run.rootSessionID,
    )
    if (!result.ok) throw new Error(`run.cancel failed: ${result.error.detail}`)
    return result.value
  }

  async unloadPlugin() {
    await this.control("unload")
  }

  async reloadPlugin() {
    await this.control("reload")
  }

  async suppressInvalidations(suppress: boolean) {
    await this.control("events", { suppress })
  }

  async setCapabilityVersion(schemaVersion: number) {
    await this.control("capabilities", { schemaVersion })
  }

  async restartDisposableHost() {
    const previous = this.owned
    await stopProcess(previous.process)
    const process = spawnHost(this.target, hostScript, previous.directories, (chunk, stream) => {
      if (stream === "stdout") this.stdout += chunk
      else this.stderr += chunk
    })
    this.manifest = { ...previous, pid: process.pid ?? 0, process }
    await this.waitForReady()
    await this.writeLogs()
    return this.manifest
  }

  async spawnSecondaryHost() {
    const port = requireDisposablePort(this.target.port + 1)
    const existing = this.owned
    const secondaryRoot = path.join(existing.directories.root, "secondary")
    const directories = {
      root: secondaryRoot,
      owner: path.join(secondaryRoot, "owner"),
      worktree: path.join(secondaryRoot, "worktrees", "feature"),
      data: path.join(secondaryRoot, "data"),
      logs: secondaryRoot,
    }
    await Promise.all([directories.owner, directories.worktree, directories.data].map((dir) => mkdir(dir, { recursive: true })))
    const process = spawnHost(
      { ...this.target, port },
      hostScript,
      directories,
      () => {},
      defaultSessions(directories.owner, directories.worktree),
    )
    const serverURL = `http://${this.target.host}:${port}`
    const deadline = Date.now() + 30_000
    for (;;) {
      try {
        const response = await fetch(`${serverURL}/__test/health`, { headers: this.authHeaders() })
        if (response.ok && ((await response.json()) as { ok?: boolean }).ok === true) break
      } catch {}
      if (Date.now() > deadline) {
        await stopProcess(process)
        throw new Error("secondary disposable execution host did not become ready")
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return {
      serverURL,
      port,
      pid: process.pid ?? 0,
      process,
      stop: () => stopProcess(process),
    }
  }

  task(page: Page, taskID: string): Locator {
    return page.locator(`[data-testid="execution-map-node"][data-task-id="${taskID}"]`)
  }

  panel(page: Page): Locator {
    return page.getByTestId("execution-panel")
  }

  connection(page: Page): Locator {
    return page.getByTestId("execution-status-badge")
  }

  async open(page: Page, run: ExecutionRunRef) {
    await page.goto(`${this.sessionHref(run.rootSessionID)}${this.authQuery()}`)
    await expect(page.locator("[data-session-title]")).toBeVisible()
    const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await this.connection(page).click()
    await expect(this.panel(page)).toBeVisible()
    const map = page.getByRole("tab", { name: "Map", exact: true })
    if (await map.isEnabled()) await map.click()
  }

  async disconnectDashboard(page: Page) {
    await this.suppressInvalidations(true)
    await page.context().setOffline(true)
  }

  async hideExecution(page: Page) {
    await page.locator("#session-side-panel-review-tab").click()
    await expect(page.locator("#session-side-panel-review-tab")).toHaveAttribute("aria-selected", "true")
  }

  async showExecution(page: Page) {
    await page.locator("#session-side-panel-execution-tab").click()
    await expect(this.panel(page)).toBeVisible()
  }

  async reconnectDashboard(page: Page, run: ExecutionRunRef) {
    await page.context().setOffline(false)
    await this.suppressInvalidations(false)
    await this.open(page, run)
  }

  private async writeLogs() {
    if (this.manifest === undefined) return
    await writeFile(path.join(this.manifest.directories.logs, "host.log"), this.logs())
  }

  async stop() {
    const current = this.manifest
    if (current === undefined) return
    this.manifest = undefined
    await stopProcess(current.process)
    if (process.env.EXECUTION_E2E_KEEP !== "1") await rm(current.directories.root, { recursive: true, force: true })
  }
}

function taskFor(run: RunSnapshot, taskID: string): Task {
  const task = run.tasks.find((candidate) => candidate.id === taskID)
  if (task === undefined) throw new Error(`task ${taskID} is not part of run ${run.runID}`)
  return task
}

function spawnHost(
  target: ExecutionTestTarget,
  script: string,
  directories: ExecutionHostManifest["directories"],
  onData: (chunk: string, stream: "stdout" | "stderr") => void,
  sessions?: readonly unknown[],
) {
  const child = spawn(target.executable, [script], {
    env: {
      ...process.env,
      EXECUTION_HOST_DIRECTORY: directories.owner,
      EXECUTION_HOST_DATA: directories.data,
      EXECUTION_HOST_PORT: String(target.port),
      EXECUTION_HOST_PASSWORD: target.password,
      EXECUTION_HOST_SESSIONS: JSON.stringify(sessions ?? defaultSessions(directories.owner, directories.worktree)),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout?.on("data", (chunk: Buffer) => onData(chunk.toString(), "stdout"))
  child.stderr?.on("data", (chunk: Buffer) => onData(chunk.toString(), "stderr"))
  return child
}

function defaultSessions(owner: string, worktree: string) {
  return [
    { id: EXECUTION_ROOT_SESSION, directory: owner, title: "Execution root", running: true },
    { id: EXECUTION_CHILD_SESSION, parentID: EXECUTION_ROOT_SESSION, directory: worktree, title: "Feature worktree child" },
    { id: EXECUTION_REVIEWER_SESSION, parentID: EXECUTION_ROOT_SESSION, directory: owner, title: "Reviewer" },
    { id: EXECUTION_STRANGER_SESSION, directory: worktree, title: "Stranger root" },
    { id: EXECUTION_STRANGER_CHILD_SESSION, parentID: EXECUTION_STRANGER_SESSION, directory: owner, title: "Stranger child" },
  ]
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  child.kill("SIGTERM")
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000))
  await Promise.race([exited, timeout])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL")
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
  }
}
