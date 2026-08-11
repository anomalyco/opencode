import type { Hooks, NoFailures } from "./registration.js"

export interface ShellCreateBefore {
  command: string
  cwd: string
  timeout: number
  shell: string
  env: Record<string, string | undefined>
}

export interface ShellHooks {
  readonly "create.before": ShellCreateBefore
}

export type ShellFailures = NoFailures<ShellHooks>

export interface ShellDomain {
  readonly hook: Hooks<ShellHooks, ShellFailures>
}
