import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { which } from "@/util/which"

export async function bundle(cmd: string, args: string[], cwd = Instance.directory) {
  const bin = which("bundle")
  if (!bin) return
  const files = await Filesystem.findUp(["Gemfile.lock", "Gemfile"], cwd, Instance.worktree)
  if (files.length === 0) return
  const out = await Process.run([bin, "exec", cmd, "--version"], {
    cwd,
    nothrow: true,
  })
  if (out.code !== 0) return
  return [bin, "exec", cmd, ...args]
}
