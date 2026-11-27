export * as SandboxBackend from "./backend.js"

import type { SandboxHostPolicy } from "./host-policy.js"
import type { SandboxPolicy } from "./policy.js"

export type Launcher = (
  policy: SandboxPolicy.Policy,
  command: string,
  args: readonly string[],
  env: SandboxPolicy.Launch["env"],
  cwd?: string,
) => SandboxPolicy.Launch | Promise<SandboxPolicy.Launch>

export interface Interface {
  readonly name: string
  readonly executable: string
  readonly probe: (policy: SandboxPolicy.Policy) => SandboxPolicy.Launch | Promise<SandboxPolicy.Launch>
  readonly policy: (
    host: SandboxHostPolicy.Host,
    options: SandboxPolicy.Options,
    databasePath?: string,
  ) => Promise<SandboxPolicy.Policy>
  readonly launch: Launcher
}

export async function select(platform: NodeJS.Platform, options: SandboxPolicy.Options): Promise<Interface> {
  switch (platform) {
    case "darwin":
      return (await import("./macos.js")).MacSandbox.backend()
    case "linux":
      // Linux uses these options to select and vet Bubblewrap before probing it.
      // All working backends receive the shared options later through backend.policy(...)
      return (await import("./linux.js")).LinuxSandbox.backend(options.linux?.binary, options.writableRoots)
    case "win32":
      return (await import("./windows.js")).WindowsSandbox.backend()
    default:
      throw new Error(`Sandboxing is unavailable on ${platform}`)
  }
}

export function posixProbe(launch: Launcher, trustedPath: string): Interface["probe"] {
  return (policy) =>
    launch(
      policy,
      "/bin/sh",
      ["-c", "exit 0"],
      { PATH: trustedPath, HOME: policy.scratch, TMPDIR: policy.scratch },
      policy.directory,
    )
}
