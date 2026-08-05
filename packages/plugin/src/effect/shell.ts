import type { Hooks } from "./registration.js"
import type { Session } from "@opencode-ai/schema/session"

export interface ShellCreateBefore {
  command: string
  cwd: string
  timeout: number
  shell: string
  env: Record<string, string | undefined>
  sessionID?: Session.ID
}

export interface ShellHooks {
  readonly "create.before": ShellCreateBefore
}

export interface ShellDomain {
  readonly hook: Hooks<ShellHooks>
}
