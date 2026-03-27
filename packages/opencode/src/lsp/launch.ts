import type { ChildProcessWithoutNullStreams } from "child_process"
import { Instance } from "../project/instance"
import { SandboxRuntime } from "../sandbox/runtime"
import { Process } from "../util"

type Child = Process.Child & ChildProcessWithoutNullStreams

function roots(cwd: string) {
  try {
    const dir = Instance.directory
    return {
      project_root: dir,
      worktree_root: Instance.worktree === "/" ? dir : Instance.worktree,
    }
  } catch {
    return {
      project_root: cwd,
      worktree_root: cwd,
    }
  }
}

export function spawn(cmd: string, args: string[], opts?: Process.Options): Promise<Child>
export function spawn(cmd: string, opts?: Process.Options): Promise<Child>
export async function spawn(cmd: string, argsOrOpts?: string[] | Process.Options, opts?: Process.Options) {
  const args = Array.isArray(argsOrOpts) ? [...argsOrOpts] : []
  const cfg = Array.isArray(argsOrOpts) ? opts : argsOrOpts
  const cwd = cfg?.cwd ?? process.cwd()
  const root = roots(cwd)
  const plan = await SandboxRuntime.plan({
    file: cmd,
    args,
    cwd,
    project_root: root.project_root,
    worktree_root: root.worktree_root,
    mode: "read-only",
    allow_network: false,
  })
  const proc = Process.spawn([plan.file, ...plan.args], {
    ...cfg,
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  }) as Child

  if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")

  return proc
}
