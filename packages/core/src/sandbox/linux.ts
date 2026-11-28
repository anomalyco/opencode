export * as LinuxSandbox from "./linux.js"

import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import { constants } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { SandboxBackend } from "./backend.js"
import { SandboxHostPolicy } from "./host-policy.js"
import type { SandboxPolicy } from "./policy.js"

const runtime = [
  "/bin",
  "/sbin",
  "/lib",
  "/lib32",
  "/lib64",
  "/usr/bin",
  "/usr/sbin",
  "/usr/lib",
  "/usr/lib32",
  "/usr/lib64",
  "/usr/libexec",
  "/usr/share",
  "/usr/include",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/local/lib",
  "/usr/local/include",
  "/etc/alternatives",
  "/etc/ld.so.cache",
  "/etc/ld.so.conf",
  "/etc/ld.so.conf.d",
  "/etc/passwd",
  "/etc/group",
  "/etc/nsswitch.conf",
  "/etc/localtime",
  "/etc/os-release",
  "/etc/ssl/certs",
]

type Entry = {
  readonly path: string
  readonly access: "read" | "write" | "deny"
}

const entry = (path: string, access: Entry["access"]): Entry => ({ path, access })
const unique = (paths: readonly string[]) => [...new Set(paths)].sort()

async function gitMetadata(workspace: string, excluded: readonly string[]) {
  const pending = [workspace]
  const protectedPaths = new Set<string>()
  while (pending.length) {
    const directory = pending.pop()!
    if (excluded.some((root) => SandboxHostPolicy.contains(root, directory))) continue
    let children
    try {
      children = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      // Unreadable directories are already unavailable to processes running as this user.
      if (["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) continue
      throw error
    }
    for (const child of children) {
      const target = path.join(directory, child.name)
      if (child.name !== ".git") {
        if (child.isDirectory()) pending.push(target)
        continue
      }
      protectedPaths.add(target)
      if (!child.isFile()) continue
      // Linked worktrees and submodules store the real Git directory in this pointer file.
      const handle = await fs.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
      try {
        if (!(await handle.stat()).isFile()) throw new Error("Git metadata changed during sandbox setup")
        const bytes = Buffer.alloc(4096)
        const { bytesRead } = await handle.read(bytes)
        const pointer = /^gitdir: (.+)\r?$/m.exec(bytes.toString("utf8", 0, bytesRead))
        if (!pointer) continue
        if (bytesRead === bytes.length && !bytes.includes(10)) throw new Error("Git directory pointer is too long")
        const destination = path.resolve(directory, pointer[1].trimEnd())
        protectedPaths.add(destination)
        protectedPaths.add(await SandboxHostPolicy.canonicalPath(destination))
      } finally {
        await handle.close()
      }
    }
  }
  return [...protectedPaths]
}

export async function profile(policy: SandboxPolicy.Policy, executable: string) {
  const denied = unique(policy.unreadablePaths)
  const masks = denied.filter(
    (value) => !denied.some((root) => root !== value && SandboxHostPolicy.contains(root, value)),
  )
  const protectedPaths = unique([
    ...policy.protectedPaths,
    executable,
    ...(policy.allowGitWrites ? [] : await gitMetadata(policy.directory, denied)),
  ])
  const hidden = (value: string) => denied.some((root) => SandboxHostPolicy.contains(root, value))
  const writable = (value: string) =>
    !hidden(value) && !protectedPaths.some((root) => SandboxHostPolicy.contains(root, value))
  const entries = [
    ...(policy.fullDiskRead ? [entry("/", "read")] : []),
    ...unique([...runtime, ...policy.readableRoots, executable])
      .filter((value) => !hidden(value))
      .map((value) => entry(value, "read")),
    ...unique(policy.writableRoots)
      .filter(writable)
      .map((value) => entry(value, "write")),
    ...protectedPaths
      .filter((value) => !hidden(value) && policy.writableRoots.some((root) => SandboxHostPolicy.contains(root, value)))
      .map((value) => entry(value, "read")),
    ...masks.map((value) => entry(value, "deny")),
  ]
  return entries
}

// Linux audit architecture and syscall numbers from the kernel UAPI.
const syscallTables: Partial<
  Record<NodeJS.Architecture, { audit: number; denied: number[]; sendto: number; socketpair: number }>
> = {
  arm64: {
    audit: 0xc00000b7, // AUDIT_ARCH_AARCH64
    denied: [
      198, // socket
      200, // bind
      202, // accept
      203, // connect
      242, // accept4
      269, // sendmmsg
      117, // ptrace
      270, // process_vm_readv
      271, // process_vm_writev
    ],
    sendto: 206,
    socketpair: 199,
  },
  x64: {
    audit: 0xc000003e, // AUDIT_ARCH_X86_64
    denied: [
      41, // socket
      49, // bind
      43, // accept
      42, // connect
      288, // accept4
      307, // sendmmsg
      101, // ptrace
      310, // process_vm_readv
      311, // process_vm_writev
    ],
    sendto: 44,
    socketpair: 53,
  },
}

// Classic BPF opcodes from linux/filter.h and linux/bpf_common.h.
const bpf = {
  loadWord: 0x20, // BPF_LD | BPF_W | BPF_ABS
  jumpEqual: 0x15, // BPF_JMP | BPF_JEQ | BPF_K
  jumpGreaterOrEqual: 0x35, // BPF_JMP | BPF_JGE | BPF_K
  returnConstant: 0x06, // BPF_RET | BPF_K
}
const seccompAction = {
  killProcess: 0x80000000, // SECCOMP_RET_KILL_PROCESS
  deny: 0x00050000 | constants.errno.EPERM, // SECCOMP_RET_ERRNO
  allow: 0x7fff0000, // SECCOMP_RET_ALLOW
}
// Byte offsets in little-endian struct seccomp_data.
const seccompOffset = {
  syscall: 0, // nr
  arch: 4,
  firstArgument: 16, // args[0]
  sendtoDestinationLow: 48, // args[4], low word
  sendtoDestinationHigh: 52, // args[4], high word
}
const x32SyscallBit = 0x40000000 // __X32_SYSCALL_BIT
const AF_UNIX = 1
const ioUringSyscalls = [425, 426, 427] // io_uring_setup, io_uring_enter, io_uring_register

// Classic BPF sock_filter instructions in native byte order on supported Linux targets.
function seccomp() {
  const arch = process.arch
  const table = syscallTables[arch]
  if (!table) throw new Error(`Linux sandboxing is unavailable on ${arch}`)
  // Each instruction is [opcode, true jump, false jump, operand]. Jumps count from the next instruction.
  const instructions: [number, number, number, number][] = [
    [bpf.loadWord, 0, 0, seccompOffset.arch],
    [bpf.jumpEqual, 1, 0, table.audit],
    [bpf.returnConstant, 0, 0, seccompAction.killProcess],
    [bpf.loadWord, 0, 0, seccompOffset.syscall],
    [bpf.jumpGreaterOrEqual, 0, 1, x32SyscallBit],
    [bpf.returnConstant, 0, 0, seccompAction.killProcess],
  ]
  // Block socket creation and use of inherited sockets to connect or send to another endpoint.
  // Local AF_UNIX socketpairs can still be used for IPC within the sandbox.
  for (const syscall of [...table.denied, ...ioUringSyscalls]) {
    instructions.push([bpf.jumpEqual, 0, 1, syscall], [bpf.returnConstant, 0, 0, seccompAction.deny])
  }
  // Bun writes to socket-backed stdio using send(), which Linux implements
  // as sendto() with a null destination. Check both halves of the pointer.
  instructions.push(
    [bpf.jumpEqual, 0, 7, table.sendto], // sendto
    [bpf.loadWord, 0, 0, seccompOffset.sendtoDestinationLow],
    [bpf.jumpEqual, 1, 0, 0],
    [bpf.returnConstant, 0, 0, seccompAction.deny],
    [bpf.loadWord, 0, 0, seccompOffset.sendtoDestinationHigh],
    [bpf.jumpEqual, 1, 0, 0],
    [bpf.returnConstant, 0, 0, seccompAction.deny],
    [bpf.returnConstant, 0, 0, seccompAction.allow],
    [bpf.jumpEqual, 0, 3, table.socketpair], // socketpair
    [bpf.loadWord, 0, 0, seccompOffset.firstArgument],
    [bpf.jumpEqual, 1, 0, AF_UNIX],
    [bpf.returnConstant, 0, 0, seccompAction.deny],
    [bpf.returnConstant, 0, 0, seccompAction.allow],
  )
  const instructionSize = 8 // sizeof(struct sock_filter)
  const bytes = Buffer.alloc(instructions.length * instructionSize)
  for (const [index, [code, yes, no, value]] of instructions.entries()) {
    bytes.writeUInt16LE(code, index * instructionSize)
    bytes[index * instructionSize + 2] = yes
    bytes[index * instructionSize + 3] = no
    bytes.writeUInt32LE(value, index * instructionSize + 4)
  }
  return Array.from(bytes, (byte) => "\\0" + byte.toString(8).padStart(3, "0")).join("")
}

const flags = [
  "--unshare-user",
  "--disable-userns",
  "--unshare-pid",
  "--unshare-ipc",
  "--unshare-net",
  "--unshare-uts",
  "--new-session",
  "--die-with-parent",
]
// Bubblewrap's procfs submounts are already read-only. Explicitly remount the
// fresh parent too, including when Bubblewrap did not create any submounts.
const procMount = ["--proc", "/proc", "--remount-ro", "/proc"]
const trustedPath = "/usr/bin:/bin:/usr/sbin:/sbin"
// Pipe the filter to Bubblewrap on fd 4 and restore the original stdin for the command.
const launchScript = 'filter=$1; shift; exec 3<&0; printf "%b" "$filter" | "$@" 4<&0 0<&3 3<&-'

const probe = promisify(execFile)

function protectBinary(roots: readonly string[], ...paths: string[]) {
  if (paths.some((file) => roots.some((root) => SandboxHostPolicy.contains(root, file))))
    throw new Error("Bubblewrap must be outside all sandbox-writable roots")
}

async function selectBubblewrap(filter: string, fallback: string, writableRoots: readonly string[], override?: string) {
  const candidates = override
    ? [override]
    : [...trustedPath.split(":").map((root) => path.join(root, "bwrap")), fallback]
  const seen = new Set<string>()
  const failures: string[] = []
  for (const candidate of candidates) {
    try {
      const executable = await fs.realpath(candidate)
      if (seen.has(executable)) continue
      seen.add(executable)
      if (!override) protectBinary(writableRoots, candidate, executable)
      const metadata = await fs.stat(executable)
      if (!metadata.isFile() || metadata.mode & 0o6022) throw new Error("unsafe binary permissions")
      for (let parent = path.dirname(executable); ; parent = path.dirname(parent)) {
        const stat = await fs.stat(parent)
        if (stat.mode & 0o022 || (stat.uid !== 0 && stat.uid !== process.getuid?.()))
          throw new Error("untrusted binary directory")
        if (parent === "/") break
      }
      if (metadata.uid !== 0 && metadata.uid !== process.getuid?.()) throw new Error("untrusted binary owner")
      await fs.access(executable, fs.constants.X_OK)
      await probe(
        "/bin/sh",
        [
          "-c",
          launchScript,
          "opencode-sandbox",
          filter,
          executable,
          ...flags,
          "--ro-bind",
          "/",
          "/",
          "--dev",
          "/dev",
          ...procMount,
          "--seccomp",
          "4",
          "--",
          "/bin/true",
        ],
        { cwd: "/", env: { PATH: trustedPath }, timeout: 5000, maxBuffer: 4096 },
      )
      return { executable, candidate }
    } catch (error) {
      if (override) throw new Error(`Cannot use configured Bubblewrap at ${override}: ${error}`, { cause: error })
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(
    `No usable Bubblewrap executable. Install bwrap or place it at ${fallback}.${
      failures.length ? " " + failures.join("; ") : ""
    }`,
  )
}

async function denyFile(scratch: string) {
  const directory = path.join(scratch, ".runtime")
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  if ((await fs.realpath(directory)) !== directory) throw new Error("Sandbox runtime directory changed")
  const file = path.join(directory, "unreadable")
  try {
    const handle = await fs.open(file, "wx", 0)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.mode & 0o777 || stat.size !== 0) throw new Error("Invalid sandbox file mask")
  return file
}

async function mounts(policy: SandboxPolicy.Policy, executable: string) {
  const fileMask = await denyFile(policy.scratch)
  const entries = await profile(policy, executable)
  const args = policy.fullDiskRead ? [] : ["--tmpfs", "/"]
  const depth = (value: string) => value.split("/").length
  const effective = new Map(entries.map((item) => [item.path, item.access]))
  for (const [target, access] of [...effective].sort(([a], [b]) => depth(a) - depth(b))) {
    // Always replace the host device and process trees with fresh isolated mounts.
    if (["/dev", "/proc"].some((root) => SandboxHostPolicy.contains(root, target))) continue
    const metadata = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined
      throw error
    })
    const insideWrite = policy.writableRoots.some((root) => SandboxHostPolicy.contains(root, target))
    if (insideWrite && metadata && (await fs.realpath(target)) !== target)
      throw new Error(`Cannot enforce Linux sandbox mount through a writable symlink: ${target}`)
    if (access === "deny") {
      if (metadata?.isDirectory()) {
        args.push("--perms", "000", "--tmpfs", target, "--remount-ro", target)
      } else if (metadata || insideWrite) {
        args.push("--ro-bind", fileMask, target)
      }
      continue
    }
    if (metadata?.isSymbolicLink()) {
      if (!policy.fullDiskRead && runtime.includes(target)) {
        const destination = await fs.realpath(target)
        args.push("--ro-bind", destination, destination, "--symlink", destination, target)
      }
      continue
    }
    if (metadata) args.push(access === "write" ? "--bind" : "--ro-bind", target, target)
    else if (access === "write") throw new Error(`Missing writable sandbox root: ${target}`)
    else if (insideWrite && policy.protectedPaths.includes(target)) {
      if (["opencode.json", "opencode.jsonc"].includes(path.basename(target))) {
        args.push("--ro-bind", "/dev/null", target)
      } else {
        args.push("--perms", "555", "--tmpfs", target, "--remount-ro", target)
      }
    }
  }
  args.push("--dev", "/dev", ...procMount)
  if (!policy.fullDiskRead) args.push("--remount-ro", "/")
  return args
}

export async function backend(
  binary?: string,
  writableRoots: readonly string[] = [],
): Promise<SandboxBackend.Interface> {
  if (binary !== undefined && (!path.isAbsolute(binary) || binary.includes("\0")))
    throw new Error("experimental.sandbox.linux.binary must be an absolute executable path")
  const override = binary === undefined ? undefined : path.normalize(binary)
  const fallback = path.join(path.dirname(await fs.realpath(process.execPath)), "opencode-sandbox", "bwrap")
  const roots = await SandboxHostPolicy.roots(writableRoots)
  const filter = seccomp()
  const { executable, candidate } = await selectBubblewrap(filter, fallback, roots, override)
  const launch: SandboxBackend.Launcher = async (policy, command, args, env, cwd) => {
    if (!override) protectBinary(policy.writableRoots, executable, candidate)
    return {
      command: "/bin/sh",
      args: [
        "-c",
        launchScript,
        "opencode-sandbox",
        filter,
        executable,
        ...flags,
        ...(await mounts(policy, executable)),
        "--seccomp",
        "4",
        "--chdir",
        cwd ? await fs.realpath(cwd) : policy.directory,
        "--",
        command,
        ...args,
      ],
      env,
    }
  }
  return {
    name: "Linux Bubblewrap",
    executable,
    policy: async (host, options, databasePath) => {
      const policy = await SandboxHostPolicy.policy(host, options, [], databasePath)
      if (!override) {
        protectBinary(policy.writableRoots, executable, candidate)
        return policy
      }
      const protectedPaths = new Set([...policy.protectedPaths, override, executable])
      // Freeze the first component below each writable root so the agent cannot
      // replace the binary by renaming one of its containing directories.
      for (const root of policy.writableRoots) {
        for (const file of [override, executable]) {
          if (SandboxHostPolicy.contains(root, file))
            protectedPaths.add(path.join(root, path.relative(root, file).split(path.sep)[0]))
        }
      }
      return { ...policy, protectedPaths: [...protectedPaths] }
    },
    launch,
    probe: SandboxBackend.posixProbe(launch, trustedPath),
  }
}
