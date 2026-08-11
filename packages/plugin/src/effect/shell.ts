import type { Hooks } from "./registration.js"

export interface ShellCreateBefore {
  command: string
  cwd: string
  timeout: number
  shell: string
  env: Record<string, string | undefined>
}

export interface ShellHooks {
  readonly "create.before": { readonly event: ShellCreateBefore; readonly failure: never }
}

export interface ShellDomain {
  readonly hook: Hooks<ShellHooks>
}
