import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MacSandbox } from "../src/sandbox/macos"
import { SandboxPolicy } from "../src/sandbox/policy"

const policy: SandboxPolicy.Policy = {
  directory: "/private/tmp/project",
  fullDiskRead: false,
  readableRoots: ["/opt/toolchain"],
  writableRoots: ["/private/tmp/project", "/private/tmp/scratch"],
  protectedPaths: ["/private/tmp/project/.opencode"],
  unreadablePaths: ["/private/tmp/project/.aws"],
  scratch: "/private/tmp/scratch",
}

describe("macOS sandbox launch", () => {
  test("full-disk reads leave write, credential, and network restrictions in place", () => {
    const confined = MacSandbox.launch(policy, "/bin/sh", ["-c", "true"], {})
    const expanded = MacSandbox.launch({ ...policy, fullDiskRead: true }, "/bin/sh", ["-c", "true"], {})
    expect(confined.args[1]).not.toContain("(allow file-read* file-map-executable)")
    expect(expanded.args[1]).toContain("(allow file-read* file-map-executable)")
    expect(expanded.args[1]).not.toContain("(allow file-write*)")
    expect(expanded.args[1]).not.toContain("(allow network")
    expect(expanded.args[1]).not.toContain("(allow sysctl-read)")
    expect(expanded.args[1]).not.toContain("(allow sysctl-write")
    expect(expanded.args[1]).toContain('(sysctl-name "hw.ncpu")')
    expect(expanded.args[1]).toContain('(sysctl-name-prefix "hw.optional.")')
    expect(expanded.args[1]).not.toContain('(sysctl-name-prefix "kern.proc.')
    expect(expanded.args[1]).not.toContain('(sysctl-name-prefix "net.')
    expect(expanded.args[1]).toContain('(allow file-write* (subpath (param "WRITE_0")))')
    expect(expanded.args[1]).toContain('(deny file-write* (subpath (param "PROTECTED_0")))')
    expect(expanded.args[1]).toContain(
      '(deny file-read* file-write* file-map-executable (subpath (param "UNREADABLE_0")))',
    )
    expect(expanded.args.slice(2)).toEqual(confined.args.slice(2))
  })

  test("keeps shell syntax and untrusted paths in argv instead of executable policy", () => {
    const hostile = '/private/tmp/path\" (allow default) ;\nwith spaces'
    const command = "printf '%s' \"$(printf hello)\"; exit 7"
    const launch = MacSandbox.launch({ ...policy, writableRoots: [hostile] }, "/bin/zsh", ["-c", command], {})
    expect(launch.command).toBe("/usr/bin/sandbox-exec")
    expect(launch.args.slice(-4)).toEqual(["--", "/bin/zsh", "-c", command])
    expect(launch.args).toContain(`-DWRITE_0=${hostile}`)
    expect(launch.args[1]).not.toContain(hostile)
    expect(launch.args[1]).toContain("(deny default process-info*)")
    expect(launch.args[1]).toContain('(import "/System/Library/Sandbox/Profiles/dyld-support.sb")')
    expect(launch.args[1]).not.toContain("(allow network")
    expect(launch.args[1]).toContain('(deny file-write* (subpath (param "PROTECTED_0")))')
    expect(launch.args[1]).toContain(
      '(deny file-read* file-write* file-map-executable (subpath (param "UNREADABLE_0")))',
    )
  })

  test("removes harness credentials and startup injections without mutating the session environment", () => {
    const inherited = {
      PATH: "/usr/bin:/bin",
      HOME: "/Users/example",
      TERM: "xterm",
      OPENCODE_PASSWORD: "secret",
      OPENCODE_SERVER_PASSWORD: "secret",
      OPENCODE_CONFIG_CONTENT: "config",
      OPENAI_API_KEY: "secret",
      AWS_ACCESS_KEY_ID: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      GH_TOKEN: "secret",
      NPM_TOKEN: "secret",
      CODEX_API_KEY: "secret",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      BASH_ENV: "/tmp/injected",
      ENV: "/tmp/injected",
      NODE_OPTIONS: "--require=/tmp/injected",
      DYLD_INSERT_LIBRARIES: "/tmp/injected",
      TMPDIR: "/shared",
      TMPPREFIX: "/shared/zsh",
    }
    const env = SandboxPolicy.environment(inherited, policy.scratch)
    expect(env).toEqual({
      PATH: inherited.PATH,
      HOME: inherited.HOME,
      TERM: "xterm",
      TMPDIR: policy.scratch,
      TMP: policy.scratch,
      TEMP: policy.scratch,
      TMPPREFIX: path.join(policy.scratch, "zsh"),
    })
    expect(inherited.OPENCODE_PASSWORD).toBe("secret")
    expect(inherited.TMPDIR).toBe("/shared")
    expect(inherited.TMPPREFIX).toBe("/shared/zsh")
  })

  // Windows symlink creation requires host privileges; this backend targets macOS.
  test.skipIf(process.platform === "win32")(
    "canonicalizes symlinked grants and rejects relative or missing roots",
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-paths-"))
      try {
        const actual = path.join(root, 'directory with "quotes"')
        await fs.mkdir(actual)
        const alias = path.join(root, "alias")
        await fs.symlink(actual, alias, "dir")
        expect(await MacSandbox.roots([alias, actual])).toEqual([await fs.realpath(actual)])
        await expect(MacSandbox.roots(["relative"])).rejects.toThrow("must be absolute")
        await expect(MacSandbox.roots([path.join(root, "missing")])).rejects.toThrow()
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
  )

  test.skipIf(process.platform === "win32")(
    "resolves protected aliases and refuses grants over host state",
    async () => {
      const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-policy-")))
      try {
        const host = {
          directory: path.join(root, "workspace"),
          scratch: path.join(root, "scratch"),
          home: path.join(root, "home"),
          config: path.join(root, "config"),
          data: path.join(root, "data"),
          state: path.join(root, "state"),
        }
        await Promise.all(Object.values(host).map((value) => fs.mkdir(value)))
        const target = path.join(host.directory, "nested", "config")
        await fs.mkdir(target, { recursive: true })
        await fs.symlink(target, path.join(host.directory, ".opencode"), "dir")
        const resolved = await MacSandbox.policy(host, {})
        expect(resolved.fullDiskRead).toBe(false)
        const homebrew = ["Cellar", "opt", "bin", "sbin", "lib", "include", "Frameworks"]
          .map((name) => `/opt/homebrew/${name}`)
          .sort()
        expect(resolved.readableRoots).toEqual(homebrew)
        expect(resolved.protectedPaths).toEqual(expect.arrayContaining(homebrew))
        for (const name of ["etc", "var", "share", "Library", "Caskroom"])
          expect(resolved.readableRoots).not.toContain(`/opt/homebrew/${name}`)
        expect(resolved.readableRoots).not.toContain("/opt/homebrew")
        expect(await MacSandbox.policy(host, { fullDiskRead: true })).toEqual({ ...resolved, fullDiskRead: true })
        expect(resolved.writableRoots).toEqual([host.scratch, host.directory].sort())
        expect(resolved.protectedPaths).toContain(path.join(host.directory, "opencode.json"))
        expect(resolved.protectedPaths).toContain(target)
        expect(resolved.unreadablePaths).toContain(host.data)
        const grant = path.join(host.directory, "grant")
        await fs.mkdir(grant)
        const pinned = await MacSandbox.policy(host, { readableRoots: [grant] })
        expect(pinned.readableRoots).toEqual([...homebrew, grant].sort())
        expect(pinned.protectedPaths).toContain(grant)
        expect(
          (await MacSandbox.policy(host, { fullDiskRead: true, readableRoots: [grant] })).protectedPaths,
        ).toContain(grant)
        await fs.rmdir(grant)
        await fs.symlink(host.home, grant, "dir")
        await expect(MacSandbox.policy(host, { readableRoots: [grant] })).rejects.toThrow(
          "Configured sandbox root changed",
        )
        const launch = MacSandbox.launch(resolved, "/bin/sh", ["-c", "true"], {})
        expect(
          launch.args.some(
            (value) => value.startsWith("-DANCESTOR_") && value.endsWith(`=${path.join(host.directory, "nested")}`),
          ),
        ).toBe(true)
        await expect(MacSandbox.policy(host, { writableRoots: [root] })).rejects.toThrow("must not contain")
        await expect(MacSandbox.policy({ ...host, directory: host.home }, {})).rejects.toThrow("home directory")
        await expect(MacSandbox.policy({ ...host, directory: path.parse(root).root }, {})).rejects.toThrow(
          "filesystem root",
        )
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
  )
})

// A restricted parent sandbox cannot install another Seatbelt profile. Report the missing
// capability rather than treating a failed sandbox_apply as evidence of command confinement.
const probe =
  process.platform === "darwin"
    ? Bun.spawnSync([MacSandbox.executable, "-p", "(version 1)(allow default)", "/usr/bin/true"])
    : undefined
const kernel = probe?.exitCode === 0 ? test : test.skip
if (probe && probe.exitCode !== 0)
  console.warn(`Seatbelt integration tests unavailable: ${probe.stderr.toString().trim()}`)

kernel("Seatbelt accepts nonexistent optional readable and protected roots", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-missing-")))
  try {
    const missing = path.join(root, "not-installed", "runtime")
    const workspace = path.join(root, "workspace")
    const outside = path.join(root, "outside")
    await fs.mkdir(workspace)
    await fs.writeFile(outside, "must remain unreadable")
    const launch = MacSandbox.launch(
      {
        directory: workspace,
        fullDiskRead: false,
        readableRoots: [missing],
        writableRoots: [workspace],
        protectedPaths: [missing],
        unreadablePaths: [],
        scratch: workspace,
      },
      "/bin/sh",
      ["-c", 'printf ready; ! /bin/cat "$1"', "probe", outside],
      SandboxPolicy.environment(process.env, workspace),
    )
    const result = Bun.spawnSync([launch.command, ...launch.args], { cwd: workspace, env: launch.env })
    expect({ exit: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exit: 0 })
    expect(result.stdout.toString()).toBe("ready")
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

kernel("system shells bootstrap and run echo, pwd, and ls inside the sandbox", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-startup-")))
  try {
    const workspace = path.join(root, "workspace")
    const scratch = path.join(root, "scratch")
    await Promise.all([workspace, scratch].map((value) => fs.mkdir(value)))
    await fs.writeFile(path.join(workspace, "workspace-marker"), "hello")
    const confined: SandboxPolicy.Policy = {
      directory: workspace,
      fullDiskRead: false,
      readableRoots: [],
      writableRoots: [workspace, scratch],
      scratch,
      protectedPaths: [],
      unreadablePaths: [],
    }
    for (const shell of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
      const launch = MacSandbox.launch(
        confined,
        shell,
        ["-c", "echo foo && pwd && ls -lah"],
        SandboxPolicy.environment(process.env, scratch),
      )
      const result = Bun.spawnSync([launch.command, ...launch.args], { cwd: workspace, env: launch.env })
      expect({
        shell,
        exit: result.exitCode,
        signal: result.signalCode,
        stderr: result.stderr.toString(),
      }).toMatchObject({ exit: 0 })
      expect(result.stdout.toString()).toStartWith(`foo\n${workspace}\n`)
      expect(result.stdout.toString()).toContain("workspace-marker")
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

kernel.each([false, true])(
  "the kernel preserves write and credential restrictions with fullDiskRead=%s",
  async (fullDiskRead) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-seatbelt-")))
    try {
      const workspace = path.join(root, "workspace")
      const scratch = path.join(root, "scratch")
      const outside = path.join(root, "outside")
      const host = {
        directory: workspace,
        scratch,
        home: path.join(root, "home"),
        config: path.join(root, "config"),
        data: path.join(root, "data"),
        state: path.join(root, "state"),
      }
      await Promise.all([...Object.values(host), outside].map((value) => fs.mkdir(value)))
      await fs.mkdir(path.join(workspace, ".opencode"))
      const credentials = path.join(host.home, ".ssh")
      await fs.mkdir(credentials)
      await fs.writeFile(path.join(credentials, "key"), "credential-secret")
      await fs.writeFile(path.join(host.config, "secret"), "config-secret")
      await fs.writeFile(path.join(outside, "secret"), "outside-secret")
      const readOnly = path.join(workspace, "read-only")
      await fs.mkdir(readOnly)
      const confined = await MacSandbox.policy(host, { fullDiskRead, readableRoots: [readOnly] })
      const run = (command: string) => {
        const launch = MacSandbox.launch(
          confined,
          "/bin/sh",
          ["-c", command],
          SandboxPolicy.environment(process.env, scratch),
        )
        return Bun.spawnSync([launch.command, ...launch.args], { cwd: workspace, env: launch.env })
      }
      const allowed = run('printf hello > local; cat local; printf scratch > "$TMPDIR/ok"')
      expect(allowed.exitCode).toBe(0)
      expect(allowed.stdout.toString()).toBe("hello")
      const heredocScript = "cat <<'EOF'\nheredoc works\nEOF"
      const blockedHeredoc = MacSandbox.launch(confined, "/bin/zsh", ["-c", heredocScript], {
        ...process.env,
        TMPPREFIX: path.join(outside, "zsh"),
      })
      expect(
        Bun.spawnSync([blockedHeredoc.command, ...blockedHeredoc.args], { cwd: workspace, env: blockedHeredoc.env })
          .exitCode,
      ).not.toBe(0)
      const heredoc = MacSandbox.launch(
        confined,
        "/bin/zsh",
        ["-c", heredocScript],
        SandboxPolicy.environment({ ...process.env, TMPPREFIX: path.join(outside, "zsh") }, scratch),
      )
      const heredocResult = Bun.spawnSync([heredoc.command, ...heredoc.args], { cwd: workspace, env: heredoc.env })
      expect({
        exit: heredocResult.exitCode,
        stderr: heredocResult.stderr.toString(),
        stdout: heredocResult.stdout.toString(),
      }).toEqual({
        exit: 0,
        stderr: "",
        stdout: "heredoc works\n",
      })
      const read = run(`cat '${outside}/secret'`)
      expect(read.exitCode === 0).toBe(fullDiskRead)
      expect(read.stdout.toString().includes("outside-secret")).toBe(fullDiskRead)
      expect(run(`printf escape > '${outside}/escape'`).exitCode).not.toBe(0)
      expect(run("printf change > read-only/file").exitCode).not.toBe(0)
      expect(run(`cat '${credentials}/key'`).exitCode).not.toBe(0)
      expect(run(`cat '${host.config}/secret'`).exitCode).not.toBe(0)
      expect(run("printf config > opencode.json").exitCode).not.toBe(0)
      expect(run("printf plugin > .opencode/plugin.ts").exitCode).not.toBe(0)
      await fs.symlink(outside, path.join(workspace, "link"), "dir")
      expect(run("cat link/secret").exitCode === 0).toBe(fullDiskRead)
      expect(run("/bin/sh -c 'printf escape > link/escape'").exitCode).not.toBe(0)
      await fs.symlink(credentials, path.join(workspace, "credentials"), "dir")
      expect(
        run("/usr/bin/sandbox-exec -p '(version 1)(allow default)' /bin/sh -c 'cat credentials/key'").stdout.toString(),
      ).not.toContain("credential-secret")
      expect(await fs.readdir(outside)).toEqual(["secret"])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)

kernel("the kernel blocks reachable loopback and Unix-socket servers", async () => {
  const root = await fs.mkdtemp("/private/tmp/oc-net-")
  const socket = path.join(root, "socket")
  const tcp = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reachable") })
  const unix = Bun.serve({ unix: socket, fetch: () => new Response("reachable") })
  try {
    const confined: SandboxPolicy.Policy = {
      directory: root,
      fullDiskRead: false,
      readableRoots: [],
      writableRoots: [root],
      protectedPaths: [],
      unreadablePaths: [],
      scratch: root,
    }
    const run = async (launch: SandboxPolicy.Launch) => {
      const proc = Bun.spawn([launch.command, ...launch.args], {
        cwd: root,
        env: launch.env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exit, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      return { exit, stdout, stderr }
    }
    for (const args of [[`http://127.0.0.1:${tcp.port}`], ["--unix-socket", socket, "http://localhost"]]) {
      const request = {
        command: "/usr/bin/curl",
        args: ["--fail", "--silent", "--show-error", "--noproxy", "*", "--max-time", "2", ...args],
        env: SandboxPolicy.environment(process.env, root),
      }
      expect(await run(request)).toMatchObject({ exit: 0, stdout: "reachable" })
      for (const fullDiskRead of [false, true]) {
        const denied = await run(
          MacSandbox.launch({ ...confined, fullDiskRead }, request.command, request.args, request.env),
        )
        expect(denied.exit).not.toBe(0)
        expect(denied.stdout).not.toContain("reachable")
      }
    }
  } finally {
    tcp.stop(true)
    unix.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})

const python = Bun.which("python3")
const pythonKernel = probe?.exitCode === 0 && python ? test : test.skip
pythonKernel("full-disk reads let installed Python load its runtime and urllib without readable roots", async () => {
  if (!python) throw new Error("Python is unavailable")
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-python-")))
  try {
    const launch = MacSandbox.launch(
      {
        directory: root,
        fullDiskRead: true,
        readableRoots: [],
        writableRoots: [root],
        protectedPaths: [],
        unreadablePaths: [],
        scratch: root,
      },
      python,
      ["-I", "-B", "-c", 'import ssl, urllib.request; print("runtime ready")'],
      SandboxPolicy.environment(process.env, root),
    )
    const result = Bun.spawnSync([launch.command, ...launch.args], { cwd: root, env: launch.env })
    expect({ exit: result.exitCode, signal: result.signalCode, stderr: result.stderr.toString() }).toMatchObject({
      exit: 0,
    })
    expect(result.stdout.toString()).toBe("runtime ready\n")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

const homebrewPython = Bun.which("/opt/homebrew/bin/python3")
const homebrewKernel = probe?.exitCode === 0 && homebrewPython ? test : test.skip
homebrewKernel(
  "default strict reads run Homebrew Python and list binaries while excluding configuration and service data",
  async () => {
    if (!homebrewPython) throw new Error("Homebrew Python is unavailable")
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-homebrew-")))
    try {
      const host = {
        directory: path.join(root, "workspace"),
        scratch: path.join(root, "scratch"),
        home: path.join(root, "home"),
        config: path.join(root, "config"),
        data: path.join(root, "data"),
        state: path.join(root, "state"),
      }
      await Promise.all(Object.values(host).map((value) => fs.mkdir(value)))
      const confined = await MacSandbox.policy(host, {})
      const run = (command: string, args: string[]) => {
        const launch = MacSandbox.launch(confined, command, args, SandboxPolicy.environment(process.env, host.scratch))
        return Bun.spawnSync([launch.command, ...launch.args], { cwd: host.directory, env: launch.env })
      }
      const python = run(homebrewPython, ["-I", "-B", "-c", 'import ssl, urllib.request; print("runtime ready")'])
      expect({ exit: python.exitCode, signal: python.signalCode, stderr: python.stderr.toString() }).toMatchObject({
        exit: 0,
      })
      expect(python.stdout.toString()).toBe("runtime ready\n")
      expect(run("/bin/ls", ["/opt/homebrew/bin"]).exitCode).toBe(0)
      for (const directory of ["etc", "var", "share", "Library", "Caskroom"])
        expect(run("/bin/ls", [`/opt/homebrew/${directory}`]).exitCode).not.toBe(0)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)

kernel.each([false, true])(
  "reference grants in OpenCode data preserve private files with fullDiskRead=%s",
  async (fullDiskRead) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-reference-policy-")))
    try {
      const host = {
        directory: path.join(root, "workspace"),
        scratch: path.join(root, "scratch"),
        home: path.join(root, "home"),
        config: path.join(root, "config"),
        data: path.join(root, "data (test)"),
        state: path.join(root, "state"),
      }
      await Promise.all(Object.values(host).map((value) => fs.mkdir(value)))
      await fs.mkdir(path.join(host.data, "repos"))
      await fs.mkdir(path.join(host.data, "log"))
      await fs.writeFile(path.join(host.data, "repos", "readme"), "reference-public")
      const authTarget = path.join(root, "auth-target")
      await fs.writeFile(authTarget, "auth-secret")
      await fs.symlink(authTarget, path.join(host.data, "auth.json"))
      await fs.writeFile(path.join(host.data, "opencode.db"), "db-secret")
      await fs.writeFile(path.join(host.data, "opencode.db-wal"), "wal-secret")
      await fs.writeFile(path.join(host.data, "log", "log.txt"), "log-secret")
      await fs.writeFile(path.join(host.config, "settings"), "config-secret")
      const credentials = path.join(host.home, ".ssh")
      await fs.mkdir(credentials)
      await fs.writeFile(path.join(credentials, "key"), "ssh-secret")
      const base = await MacSandbox.policy(host, { fullDiskRead })
      const confined = await MacSandbox.references(base, host, [host.data, host.config, credentials])
      // The pattern protects database files created after the profile was prepared.
      await fs.writeFile(path.join(host.data, "opencode-new.db-shm"), "shm-secret")
      await fs.writeFile(path.join(host.data, "OPENCODE-NEW.DB-JOURNAL"), "journal-secret")
      const run = (command: string) => {
        const launch = MacSandbox.launch(
          confined,
          "/bin/sh",
          ["-c", command],
          SandboxPolicy.environment(process.env, host.scratch),
        )
        return Bun.spawnSync([launch.command, ...launch.args], { cwd: host.directory, env: launch.env })
      }
      expect(run(`cat '${host.data}/repos/readme'`).stdout.toString()).toBe("reference-public")
      expect(run(`ls '${host.data}'`).exitCode).toBe(0)
      for (const target of [
        path.join(host.data, "auth.json"),
        authTarget,
        path.join(host.data, "opencode.db"),
        path.join(host.data, "opencode.db-wal"),
        path.join(host.data, "opencode-new.db-shm"),
        path.join(host.data, "OPENCODE-NEW.DB-JOURNAL"),
        path.join(host.data, "log", "log.txt"),
        path.join(host.config, "settings"),
        path.join(credentials, "key"),
      ]) {
        expect(run(`cat '${target}'`).exitCode).not.toBe(0)
      }
      expect(run(`printf escape > '${host.data}/repos/new'`).exitCode).not.toBe(0)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)
