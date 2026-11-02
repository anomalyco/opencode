export type Task = {
  id: string
  category: string
  prompt: string
  files: Record<string, string>
  verify: {
    files?: Record<string, string>
    command?: string[]
  }
  solution?: Record<string, string>
  /** Final answer used by --audit for tasks that do not change files. */
  solutionFinal?: string
  /** Defaults to true. A seeded task must fail verification before the agent runs. */
  seeded?: boolean
  /** Defaults to true. Include in runs that do not name a task. */
  default?: boolean
  timeoutMs?: number
}

export type Usage = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  cost: number
}

export type ProcessResult = {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

export type RunResult = {
  task: string
  category: string
  run: number
  model: string
  agent: string
  startedAt: string
  durationMs: number
  timedOut: boolean
  exitCode: number
  validCompletion: boolean
  verified: boolean
  verification: ProcessResult
  usage: Usage
  steps: number
  toolCalls: number
  toolErrors: number
  errors: string[]
  finalText: string
  diffPath: string
  stdoutPath: string
  stderrPath: string
  workspace?: string
}
