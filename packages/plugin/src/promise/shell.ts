import type { Session } from "@opencode/schema/session"
import type { Hooks } from "./registration.js"

/** Who started a Session's command: the agent through its shell tool, or the user directly. */
export interface ShellCreateSource {
  readonly type: "tool" | "user"
  readonly sessionID: Session.ID
}

export interface ShellCreateBefore {
  /** Absent for commands started outside a Session. */
  readonly source?: ShellCreateSource
  command: string
  cwd: string
  timeout: number
  shell: string
  env: Record<string, string | undefined>
}

export interface ShellHooks {
  readonly "create.before": ShellCreateBefore
}

export interface ShellDomain {
  readonly hook: Hooks<ShellHooks>
}
