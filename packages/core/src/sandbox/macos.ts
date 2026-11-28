export * as MacSandbox from "./macos.js"

import path from "node:path"
import { SandboxBackend } from "./backend.js"
import { SandboxHostPolicy } from "./host-policy.js"
import type { SandboxPolicy } from "./policy.js"

export const executable = "/usr/bin/sandbox-exec"

// Keep host runtime access separate from workspace grants. In particular, do not grant all of HOME,
// /private/var, /Applications, or Homebrew's configuration and service data.
const runtime = [
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/usr/lib",
  "/usr/libexec",
  "/usr/share",
  "/System/Library",
  "/Library/Apple",
  "/Library/Developer/CommandLineTools",
  "/Library/Preferences",
  "/private/etc",
  "/private/var/db/timezone",
  "/private/var/db/dyld",
]

// Seatbelt accepts missing paths. Keep these optional runtime grants out of roots(),
// which deliberately requires user-supplied paths to exist and pins their real paths.
const homebrew = ["Cellar", "opt", "bin", "sbin", "lib", "include", "Frameworks"].map((name) =>
  path.join("/opt/homebrew", name),
)

// CPU/runtime discovery follows Codex's seatbelt_base_policy.sbpl. Do not include
// its process and routing-table prefixes: these commands have no host-inspection
// or networking grant. In particular, kern.procargs2 can disclose host credentials.
const sysctls = [
  "hw.activecpu",
  "hw.busfrequency_compat",
  "hw.byteorder",
  "hw.cacheconfig",
  "hw.cachelinesize_compat",
  "hw.cpufamily",
  "hw.cpufrequency_compat",
  "hw.cputype",
  "hw.l1dcachesize_compat",
  "hw.l1icachesize_compat",
  "hw.l2cachesize_compat",
  "hw.l3cachesize_compat",
  "hw.logicalcpu_max",
  "hw.machine",
  "hw.model",
  "hw.memsize",
  "hw.ncpu",
  "hw.nperflevels",
  "hw.packages",
  "hw.pagesize_compat",
  "hw.pagesize",
  "hw.physicalcpu",
  "hw.physicalcpu_max",
  "hw.logicalcpu",
  "hw.cpufrequency",
  "hw.tbfrequency_compat",
  "hw.vectorunit",
  "machdep.cpu.brand_string",
  "kern.argmax",
  "kern.hostname",
  "kern.maxfilesperproc",
  "kern.maxproc",
  "kern.osproductversion",
  "kern.osrelease",
  "kern.ostype",
  "kern.osvariant_status",
  "kern.osversion",
  "kern.secure_kernel",
  "kern.sysv.semmns",
  "kern.usrstack64",
  "kern.version",
  "sysctl.proc_cputype",
  "vm.loadavg",
]

export const { roots } = SandboxHostPolicy
const { contains } = SandboxHostPolicy
const trustedPath = "/usr/bin:/bin"

export const policy = (host: SandboxHostPolicy.Host, options: SandboxPolicy.Options, databasePath?: string) =>
  SandboxHostPolicy.policy(host, options, homebrew, databasePath)

// SBPL parameters keep paths out of executable policy text, including quotes and newlines.
export function readableRoots(policy: SandboxPolicy.Policy) {
  return [...new Set([...runtime, ...policy.readableRoots, ...policy.writableRoots])]
}

export function launch(
  policy: SandboxPolicy.Policy,
  command: string,
  args: readonly string[],
  env: SandboxPolicy.Launch["env"],
): SandboxPolicy.Launch {
  const readable = readableRoots(policy)
  // A protected subtree must not become writable by renaming one of its writable ancestors.
  const ancestors = [
    ...new Set(
      policy.protectedPaths.flatMap((value) => {
        const result: string[] = []
        for (let parent = path.dirname(value); parent !== path.dirname(parent); parent = path.dirname(parent)) {
          if (!policy.writableRoots.some((root) => contains(root, parent))) break
          result.push(parent)
        }
        return result
      }),
    ),
  ]
  // Match whole path components under the canonical workspace, including .git files used by submodules.
  const workspace = policy.directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const parameters = [
    ...(policy.allowGitWrites ? [] : [`-DWORKSPACE_GIT=^${workspace}/([^/]+/)*[.]git(/|$)`]),
    ...readable.map((value, index) => `-DREAD_${index}=${value}`),
    ...policy.writableRoots.map((value, index) => `-DWRITE_${index}=${value}`),
    ...policy.protectedPaths.map((value, index) => `-DPROTECTED_${index}=${value}`),
    ...policy.unreadablePaths.map((value, index) => `-DUNREADABLE_${index}=${value}`),
    ...ancestors.map((value, index) => `-DANCESTOR_${index}=${value}`),
  ]
  const profile = [
    "(version 1)",
    // process-info operations have an implicit allow disposition on macOS; deny
    // default alone does not override it. Set their default explicitly, then allow
    // same-sandbox targets below (including self and descendants).
    "(deny default process-info*)",
    // Apple's loader opens / as an openat root before mapping the Cryptex shared cache.
    // File metadata access alone is insufficient and libignition aborts before shell startup.
    // Use the OS-maintained bootstrap rules, which grant neither networking nor writes.
    '(import "/System/Library/Sandbox/Profiles/dyld-support.sb")',
    "(allow process-exec process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow process-info* (target same-sandbox))",
    // Runtime paths require directory traversal, without disclosing arbitrary file contents.
    "(allow file-read-metadata)",
    ...(policy.fullDiskRead
      ? ["(allow file-read* file-map-executable)"]
      : readable.map((_, index) => `(allow file-read* file-map-executable (subpath (param \"READ_${index}\")))`)),
    ...policy.writableRoots.map((_, index) => `(allow file-write* (subpath (param \"WRITE_${index}\")))`),
    ...policy.writableRoots.map((_, index) => `(deny file-write-unlink (literal (param \"WRITE_${index}\")))`),
    ...(policy.allowGitWrites ? [] : ['(deny file-write* (regex (param "WORKSPACE_GIT")))']),
    ...policy.protectedPaths.map((_, index) => `(deny file-write* (subpath (param \"PROTECTED_${index}\")))`),
    ...policy.unreadablePaths.map(
      (_, index) => `(deny file-read* file-write* file-map-executable (subpath (param \"UNREADABLE_${index}\")))`,
    ),
    ...ancestors.map((_, index) => `(deny file-write-unlink (literal (param \"ANCESTOR_${index}\")))`),
    '(allow file-read* file-write-data (literal "/dev/null") (literal "/dev/zero"))',
    '(allow file-read* (literal "/dev/random") (literal "/dev/urandom"))',
    '(allow file-read* file-write-data (subpath "/dev/fd"))',
    "(allow sysctl-read",
    ...sysctls.map((name) => `  (sysctl-name "${name}")`),
    // CPU feature flags cover both Intel and Apple Silicon; perflevel keys describe
    // heterogeneous CPU/cache topology, not process or network state.
    '  (sysctl-name-prefix "hw.optional.")',
    '  (sysctl-name-prefix "hw.perflevel")',
    // sysctl(8) looks up numeric OID names and formats before reading a value.
    // These metadata queries can reveal names/types even when the value is denied.
    '  (sysctl-name-prefix "sysctl.name.")',
    '  (sysctl-name-prefix "sysctl.oidfmt.")',
    ")",
    '(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))',
    // These mutating fcntls bypass file-write checks even on a read-only descriptor.
    "(deny system-fcntl (fcntl-command 80 110))",
    // No network, Unix sockets, arbitrary Mach services, or signals to host processes.
  ].join("\n")
  return { command: executable, args: ["-p", profile, ...parameters, "--", command, ...args], env }
}

export function backend(): SandboxBackend.Interface {
  return { name: "macOS Seatbelt", executable, policy, launch, probe: SandboxBackend.posixProbe(launch, trustedPath) }
}
