import { SandboxSpawn } from "./spawn"

export namespace SandboxRuntime {
  export interface SpawnPlan {
    active: boolean
    file: string
    args: string[]
    env?: Record<string, string>
    diag: SandboxSpawn.Diag
  }

  export interface Input {
    file: string
    args: string[]
    cwd: string
    project_root: string
    worktree_root: string
    preset?: string
    mode?: SandboxSpawn.Mode
    allow_network?: boolean
    allow_unix_sockets?: boolean
    cfg?: SandboxSpawn.Settings
  }

  export async function plan(input: Input): Promise<SpawnPlan> {
    const sandbox = await SandboxSpawn.resolve(
      {
        cwd: input.cwd,
        project_root: input.project_root,
        worktree_root: input.worktree_root,
        preset: input.preset,
        mode: input.mode,
        allow_network: input.allow_network,
        allow_unix_sockets: input.allow_unix_sockets,
      },
      input.cfg,
    )

    if (!sandbox.active || !sandbox.profile) {
      return {
        active: false,
        file: input.file,
        args: input.args,
        diag: sandbox.diag,
      }
    }

    const cmd = SandboxSpawn.wrap({
      profile: sandbox.profile,
      file: input.file,
      args: input.args,
    })

    return {
      active: true,
      file: cmd.file,
      args: cmd.args,
      diag: sandbox.diag,
    }
  }
}
