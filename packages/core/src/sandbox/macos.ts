export * as MacSandbox from "./macos.js"

import fs from "node:fs/promises"
import path from "node:path"
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

export async function roots(values: readonly string[]) {
  return [
    ...new Set(
      await Promise.all(
        values.map(async (value) => {
          if (!path.isAbsolute(value) || value.includes("\0"))
            throw new Error(`Sandbox root must be absolute: ${value}`)
          return fs.realpath(value)
        }),
      ),
    ),
  ].sort()
}

export async function policy(
  host: { directory: string; scratch: string; home: string; config: string; data: string; state: string },
  options: SandboxPolicy.Options,
): Promise<SandboxPolicy.Policy> {
  const directory = await fs.realpath(host.directory)
  if (directory === path.parse(directory).root || directory === (await fs.realpath(host.home)))
    throw new Error("Select a project directory; the filesystem root and home directory cannot be sandbox workspaces.")
  // Host settings pass canonical paths. Refuse changed aliases after Location eviction,
  // rather than resolving a pinned grant to a different directory.
  await Promise.all(
    [...(options.readableRoots ?? []), ...(options.writableRoots ?? [])].map(async (value) => {
      if ((await fs.realpath(value)) !== value) throw new Error(`Configured sandbox root changed: ${value}`)
    }),
  )
  const writableRoots = await roots([directory, host.scratch, ...(options.writableRoots ?? [])])
  const readableRoots = [...new Set([...homebrew, ...(await roots(options.readableRoots ?? []))])].sort()
  const hostPaths = await roots([host.config, host.data, host.state])
  if (writableRoots.some((root) => hostPaths.some((value) => contains(root, value))))
    throw new Error("Writable sandbox roots must not contain OpenCode's configuration or state directories.")
  const scratch = await fs.realpath(host.scratch)
  const protectedPaths = [
    path.join(scratch, ".runtime"),
    ...writableRoots.flatMap((root) => [
      ...[".git", ".opencode", ".agents", ".codex", ".aws", ".ssh"].map((name) => path.join(root, name)),
      ...["opencode.json", "opencode.jsonc"].map((name) => path.join(root, name)),
    ]),
    ...hostPaths,
    ...readableRoots,
  ]
  const unreadablePaths = [
    ...hostPaths,
    ...[host.home, ...writableRoots].flatMap((root) => [path.join(root, ".aws"), path.join(root, ".ssh")]),
  ]
  // Protect both a metadata symlink and its existing target. Missing paths remain protected
  // so a command cannot create a new plugin/config directory to be loaded by the host.
  const aliases = await Promise.all(protectedPaths.map((value) => fs.realpath(value).catch(() => value)))
  const unreadableAliases = await Promise.all(unreadablePaths.map((value) => fs.realpath(value).catch(() => value)))
  return {
    directory,
    fullDiskRead: options.fullDiskRead ?? false,
    readableRoots,
    writableRoots,
    protectedPaths: [...new Set([...protectedPaths, ...aliases])],
    unreadablePaths: [...new Set([...unreadablePaths, ...unreadableAliases])],
    scratch,
  }
}

// SBPL parameters keep paths out of executable policy text, including quotes and newlines.
export function readableRoots(policy: SandboxPolicy.Policy) {
  return [...new Set([...runtime, ...policy.readableRoots, ...policy.writableRoots, ...(policy.referenceRoots ?? [])])]
}

/** Reference grants are read-only and never expose OpenCode credentials or private state. */
export async function references(
  policy: SandboxPolicy.Policy,
  host: { data: string },
  values: readonly string[],
): Promise<SandboxPolicy.Policy> {
  const referenceRoots = [...new Set(values)].sort()
  const data = await fs.realpath(host.data)
  const referenceDataRoots = referenceRoots.filter((root) => contains(data, root))
  const privateData = ["auth.json", "log", "shell", "snapshot", "storage", "tool-output", "artifacts"].map((name) =>
    path.join(data, name),
  )
  const entries = await fs.readdir(data)
  const database = /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i
  const privatePaths = [
    ...policy.unreadablePaths.filter((value) => referenceDataRoots.length === 0 || value !== data),
    ...privateData,
    ...entries.filter((name) => database.test(name)).map((name) => path.join(data, name)),
  ]
  const aliases = await Promise.all(privatePaths.map((value) => fs.realpath(value).catch(() => value)))
  const escapedData = data.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return {
    ...policy,
    referenceRoots,
    referenceDataRoots,
    referenceDeniedPaths: [...new Set([...privatePaths, ...aliases])],
    referenceDeniedPatterns: [
      `^${escapedData}/[^/]+\\.([dD][bB]|[sS][qQ][lL][iI][tT][eE]3?)(-([wW][aA][lL]|[sS][hH][mM]|[jJ][oO][uU][rR][nN][aA][lL]))?$`,
    ],
  }
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
  const parameters = [
    ...readable.map((value, index) => `-DREAD_${index}=${value}`),
    ...policy.writableRoots.map((value, index) => `-DWRITE_${index}=${value}`),
    ...policy.protectedPaths.map((value, index) => `-DPROTECTED_${index}=${value}`),
    ...policy.unreadablePaths.map((value, index) => `-DUNREADABLE_${index}=${value}`),
    ...(policy.referenceDataRoots ?? []).map((value, index) => `-DREF_DATA_${index}=${value}`),
    ...(policy.referenceDeniedPaths ?? []).map((value, index) => `-DREF_DENY_${index}=${value}`),
    ...(policy.referenceDeniedPatterns ?? []).map((value, index) => `-DREF_DENY_PATTERN_${index}=${value}`),
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
    ...policy.protectedPaths.map((_, index) => `(deny file-write* (subpath (param \"PROTECTED_${index}\")))`),
    ...policy.unreadablePaths.map(
      (_, index) => `(deny file-read* file-write* file-map-executable (subpath (param \"UNREADABLE_${index}\")))`,
    ),
    ...(policy.referenceDataRoots ?? []).map(
      (_, index) => `(allow file-read* file-map-executable (subpath (param \"REF_DATA_${index}\")))`,
    ),
    ...(policy.referenceDeniedPaths ?? []).map(
      (_, index) => `(deny file-read* file-write* file-map-executable (subpath (param \"REF_DENY_${index}\")))`,
    ),
    ...(policy.referenceDeniedPatterns ?? []).map(
      (_, index) => `(deny file-read* file-write* file-map-executable (regex (param \"REF_DENY_PATTERN_${index}\")))`,
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
    ")",
    '(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))',
    // These mutating fcntls bypass file-write checks even on a read-only descriptor.
    "(deny system-fcntl (fcntl-command 80 110))",
    // No network, Unix sockets, arbitrary Mach services, or signals to host processes.
  ].join("\n")
  return { command: executable, args: ["-p", profile, ...parameters, "--", command, ...args], env }
}

/** The trusted helper needs only its own runtime executable in addition to the normal policy. */
export function fileLaunch(policy: SandboxPolicy.Policy, runtime: string, program: string): SandboxPolicy.Launch {
  const args = process.versions.bun
    ? ["--config=/dev/null", "--no-env-file", "--no-addons", "--no-macros", "--eval", program]
    : ["--input-type=commonjs", "--eval", program]
  return launch(
    {
      ...policy,
      readableRoots: [...policy.readableRoots, runtime],
      protectedPaths: [...policy.protectedPaths, runtime],
    },
    runtime,
    args,
    {
      PATH: "/usr/bin:/bin",
      HOME: policy.scratch,
      TMPDIR: policy.scratch,
      TMP: policy.scratch,
      TEMP: policy.scratch,
      BUN_BE_BUN: "1",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      DO_NOT_TRACK: "1",
    },
  )
}

function contains(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}
