import { describe, expect, test } from "bun:test"
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const sourceInstaller = path.resolve(import.meta.dir, "../../../install.sh")
const releaseInstaller = path.resolve(import.meta.dir, "../../../install")
const pin = "1.3.14"

type Fixture = Awaited<ReturnType<typeof createFixture>>

async function executable(file: string, body: string) {
  await writeFile(file, body)
  await chmod(file, 0o755)
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-source-installer-"))
  const repo = path.join(root, "checkout")
  const tools = path.join(root, "tools")
  const bootstrap = path.join(root, "bootstrap", "bun")
  const home = path.join(root, "home")
  const cache = path.join(root, "cache")
  const outside = path.join(root, "outside")
  const log = path.join(root, "commands.log")
  const releaseMarker = path.join(root, "release-invoked")
  await mkdir(path.join(repo, "packages", "opencode"), { recursive: true })
  await mkdir(path.dirname(bootstrap), { recursive: true })
  await mkdir(tools)
  await mkdir(home)
  await mkdir(cache)
  await mkdir(outside)
  await copyFile(sourceInstaller, path.join(repo, "install.sh"))
  await chmod(path.join(repo, "install.sh"), 0o755)
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ packageManager: `bun@${pin}` }))
  await executable(
    path.join(repo, "install"),
    `#!/usr/bin/env bash\nprintf '%s\\n' invoked > ${JSON.stringify(releaseMarker)}\n`,
  )

  const fakeBun = `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\\n' "\${FAKE_BUN_VERSION:-${pin}}"
  exit 0
fi
printf 'bun' >> "\$FAKE_LOG"
printf ' <%s>' "\$@" >> "\$FAKE_LOG"
printf ' version=<%s> channel=<%s>\\n' "\${OPENCODE_VERSION:-}" "\${OPENCODE_CHANNEL:-}" >> "\$FAKE_LOG"
if [[ "\${1:-}" == "install" ]]; then
  [[ "\${FAKE_INSTALL_FAIL:-0}" != "1" ]] || exit 31
  exit 0
fi
if [[ "\${1:-}" != "run" || "\${2:-}" != "script/build.ts" ]]; then
  exit 32
fi
[[ "\${FAKE_BUILD_FAIL:-0}" != "1" ]] || exit 33
case "\$(uname -s):\$(uname -m)" in
  Linux:x86_64|Linux:amd64) target="opencode-linux-x64" ;;
  Linux:aarch64|Linux:arm64) target="opencode-linux-arm64" ;;
  Darwin:x86_64) target="opencode-darwin-x64" ;;
  Darwin:arm64) target="opencode-darwin-arm64" ;;
  *) exit 34 ;;
esac
[[ "\${FAKE_OUTPUT:-normal}" != "missing" ]] || exit 0
mkdir -p "dist/\$target/bin"
{
printf '%s\\n' '#!/usr/bin/env bash'
printf 'version=%q\\n' "\$OPENCODE_VERSION"
cat <<'EOF'
if [[ "\${1:-}" == "--version" ]]; then
  [[ "\${FAKE_CANDIDATE_FAIL:-0}" != "1" ]] || exit 41
  if [[ -n "\${FAKE_CANDIDATE_VERSION:-}" ]]; then
    printf '%s\\n' "\$FAKE_CANDIDATE_VERSION"
  else
    printf '%s\\n' "\$version"
  fi
  exit 0
fi
printf '%s\\n' new
EOF
} > "dist/\$target/bin/opencode"
/bin/chmod 0755 "dist/\$target/bin/opencode"
if [[ "\${FAKE_OUTPUT:-normal}" == "ambiguous" ]]; then
  mkdir -p "dist/\$target-baseline/bin"
  cp "dist/\$target/bin/opencode" "dist/\$target-baseline/bin/opencode"
fi
  `
  await executable(path.join(tools, "bun"), fakeBun)
  await executable(bootstrap, fakeBun.replaceAll("FAKE_BUN_VERSION", "FAKE_BOOTSTRAP_BUN_VERSION"))
  await executable(
    path.join(tools, "npx"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'npx cache=<%s>' "\${npm_config_cache:-}" >> "\$FAKE_LOG"
printf ' <%s>' "\$@" >> "\$FAKE_LOG"
printf '\\n' >> "\$FAKE_LOG"
[[ "\${FAKE_NPX_FAIL:-0}" != "1" ]] || exit 51
printf '%s\\n' "\$FAKE_BOOTSTRAP_BUN"
`,
  )

  return { root, repo, tools, bootstrap, home, cache, outside, log, releaseMarker }
}

function environment(fixture: Fixture, input?: Record<string, string | undefined>) {
  const env: Record<string, string> = {
    HOME: fixture.home,
    XDG_CONFIG_HOME: path.join(fixture.root, "config"),
    XDG_CACHE_HOME: fixture.cache,
    PATH: `${fixture.tools}:/usr/bin:/bin`,
    FAKE_LOG: fixture.log,
    FAKE_BOOTSTRAP_BUN: fixture.bootstrap,
    FAKE_BUN_VERSION: pin,
    FAKE_BOOTSTRAP_BUN_VERSION: pin,
  }
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

async function run(fixture: Fixture, args: string[] = [], input?: Record<string, string | undefined>) {
  const proc = Bun.spawn(["/bin/bash", path.join(fixture.repo, "install.sh"), ...args], {
    cwd: fixture.outside,
    env: environment(fixture, input),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

async function cleanup(fixture: Fixture) {
  await rm(fixture.root, { recursive: true, force: true })
}

async function sentinel(fixture: Fixture, installDir: string, body = "#!/usr/bin/env bash\nprintf '%s\\n' old\n") {
  await mkdir(installDir, { recursive: true })
  const target = path.join(installDir, "opencode")
  await executable(target, body)
  return { target, bytes: await readFile(target) }
}

async function expectPreserved(target: string, bytes: Uint8Array) {
  expect(Array.from(await readFile(target))).toEqual(Array.from(bytes))
  expect((await stat(target)).mode & 0o111).not.toBe(0)
  expect((await readdir(path.dirname(target))).filter((item) => item.startsWith(".opencode-install."))).toEqual([])
}

describe("source checkout installer", () => {
  test("documents help and rejects unknown options before mutation", async () => {
    const fixture = await createFixture()
    try {
      const releaseBefore = await readFile(releaseInstaller)
      expect((await stat(sourceInstaller)).mode & 0o777).toBe(0o755)
      const help = await run(fixture, ["--help"])
      expect(help.exitCode).toBe(0)
      expect(help.stdout).toContain("CLI/TUI")
      expect(help.stdout).toContain("does not embed WebUI assets")
      expect(help.stdout).toContain("--tui-only")
      expect(help.stdout).toContain("--with-web-ui")
      expect(help.stdout).toContain("cannot be combined")
      expect(help.stdout).toContain("Plain opencode launches the TUI")
      expect(help.stdout).toContain("opencode web")
      expect(help.stdout).toContain("opencode serve")
      expect(help.stdout).toContain("OPENCODE_INSTALL_DIR")
      expect(help.stdout).toContain("never modifies shell configuration")

      const invalid = await run(fixture, ["--release"])
      expect(invalid.exitCode).not.toBe(0)
      expect(invalid.stderr).toContain("Unknown option")
      expect(invalid.stderr).toContain("Usage:")
      expect(await readdir(fixture.home)).toEqual([])

      for (const args of [
        ["--tui-only", "--with-web-ui"],
        ["--with-web-ui", "--tui-only"],
      ]) {
        const conflict = await run(fixture, args)
        expect(conflict.exitCode).not.toBe(0)
        expect(conflict.stderr).toContain("cannot be combined")
        expect(conflict.stderr).toContain("Usage:")
      }
      expect(await Bun.file(fixture.log).exists()).toBe(false)
      expect(await readdir(fixture.home)).toEqual([])
      expect(Array.from(await readFile(releaseInstaller))).toEqual(Array.from(releaseBefore))
    } finally {
      await cleanup(fixture)
    }
  })

  test("reuses the exact pinned Bun for the default CLI/TUI build from outside the checkout", async () => {
    const fixture = await createFixture()
    const installDir = path.join(fixture.root, "bin with spaces;safe")
    try {
      const releaseBefore = await readFile(path.join(fixture.repo, "install"))
      const result = await run(fixture, [], { OPENCODE_INSTALL_DIR: installDir })
      expect(result).toEqual(expect.objectContaining({ exitCode: 0 }))
      const log = await readFile(fixture.log, "utf8")
      expect(log.match(/bun <install> <--frozen-lockfile>/g)).toHaveLength(1)
      expect(log).toContain("<run> <script/build.ts> <--single> <--skip-install> <--skip-embed-web-ui>")
      expect(log).toMatch(/version=<0\.0\.0-source-[0-9]{12}> channel=<source>/)
      expect(log).not.toContain("npx cache=")
      expect(log).not.toMatch(/releases|opencode\.ai\/install|registry\.npmjs\.org\/opencode-ai/)
      expect(await readFile(path.join(fixture.repo, "install"))).toEqual(releaseBefore)
      expect(await stat(path.join(fixture.repo, "install.sh"))).toEqual(
        expect.objectContaining({ mode: expect.any(Number) }),
      )
      const target = path.join(installDir, "opencode")
      expect((await stat(target)).mode & 0o777).toBe(0o755)
      expect((await Bun.$`${target} --version`.text()).trim()).toMatch(/^0\.0\.0-source-/)
      expect(result.stdout).toContain("export PATH=")
      expect(await Bun.file(fixture.releaseMarker).exists()).toBe(false)
      for (const file of [".bashrc", ".zshrc", ".profile", ".bash_profile"]) {
        expect(await Bun.file(path.join(fixture.home, file)).exists()).toBe(false)
      }
      expect(await Bun.file(path.join(fixture.home, ".bun")).exists()).toBe(false)
    } finally {
      await cleanup(fixture)
    }
  })

  test("embeds WebUI assets only with the explicit opt-in", async () => {
    const fixture = await createFixture()
    try {
      const result = await run(fixture, ["--with-web-ui"])
      expect(result.exitCode).toBe(0)
      const log = await readFile(fixture.log, "utf8")
      expect(log).toContain("<run> <script/build.ts> <--single> <--skip-install>")
      expect(log).not.toContain("--skip-embed-web-ui")
      expect(result.stdout).toContain("with embedded WebUI assets")
    } finally {
      await cleanup(fixture)
    }
  })

  test.each([
    ["missing", undefined],
    ["mismatched", "0.0.0"],
  ])("privately bootstraps pinned Bun when PATH Bun is %s", async (_name, version) => {
    const fixture = await createFixture()
    try {
      if (version === undefined) await unlink(path.join(fixture.tools, "bun"))
      const result = await run(fixture, ["--tui-only"], {
        FAKE_BUN_VERSION: version,
      })
      expect(result.exitCode).toBe(0)
      const log = await readFile(fixture.log, "utf8")
      expect(log).toContain(
        `npx cache=<${path.join(fixture.cache, "opencode", "source-installer", `bun-${pin}`, "npm")}>`,
      )
      expect(log).toContain(`<--package> <bun@${pin}>`)
      expect(log).toContain("<run> <script/build.ts> <--single> <--skip-install> <--skip-embed-web-ui>")
      expect(await Bun.file(path.join(fixture.home, ".bun")).exists()).toBe(false)
      expect(await Bun.file(path.join(fixture.home, ".bashrc")).exists()).toBe(false)
      expect((await stat(path.join(fixture.home, ".opencode", "bin", "opencode"))).mode & 0o777).toBe(0o755)
    } finally {
      await cleanup(fixture)
    }
  })

  test("selects the native single target on supported macOS arm64", async () => {
    const fixture = await createFixture()
    try {
      await executable(
        path.join(fixture.tools, "uname"),
        "#!/usr/bin/env bash\nif [[ \"$1\" == \"-s\" ]]; then printf '%s\\n' Darwin; else printf '%s\\n' arm64; fi\n",
      )
      const result = await run(fixture, ["--tui-only"])
      expect(result.exitCode).toBe(0)
      expect(await Bun.file(path.join(fixture.home, ".opencode", "bin", "opencode")).exists()).toBe(true)
      expect(await readFile(fixture.log, "utf8")).toContain(
        "<run> <script/build.ts> <--single> <--skip-install> <--skip-embed-web-ui>",
      )
    } finally {
      await cleanup(fixture)
    }
  }, 15_000)

  test.each([
    ["malformed Bun pin", "pin", "Bun pin", { PACKAGE_MANAGER: "npm@10.0.0" }],
    ["Bun bootstrap failure", "bootstrap", "Bun bootstrap", { FAKE_BUN_VERSION: "0.0.0", FAKE_NPX_FAIL: "1" }],
    [
      "Bun bootstrap version mismatch",
      "bootstrap-version",
      "Bun bootstrap",
      { FAKE_BUN_VERSION: "0.0.0", FAKE_BOOTSTRAP_BUN_VERSION: "0.0.0" },
    ],
    ["frozen dependency failure", "install", "Frozen dependency installation", { FAKE_INSTALL_FAIL: "1" }],
    ["native build failure", "build", "Native source build", { FAKE_BUILD_FAIL: "1" }],
    ["missing build output", "missing", "Build output", { FAKE_OUTPUT: "missing" }],
    ["ambiguous build output", "ambiguous", "Build output", { FAKE_OUTPUT: "ambiguous" }],
    ["candidate validation failure", "candidate", "Candidate validation", { FAKE_CANDIDATE_VERSION: "wrong" }],
  ])("preserves an old target after %s", async (_name, kind, message, values) => {
    const fixture = await createFixture()
    const installDir = path.join(fixture.root, "existing")
    try {
      const old = await sentinel(fixture, installDir)
      if (kind === "pin") {
        await writeFile(
          path.join(fixture.repo, "package.json"),
          JSON.stringify({ packageManager: "PACKAGE_MANAGER" in values ? values.PACKAGE_MANAGER : undefined }),
        )
      }
      const result = await run(fixture, [], { OPENCODE_INSTALL_DIR: installDir, ...values })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain(message)
      await expectPreserved(old.target, old.bytes)
    } finally {
      await cleanup(fixture)
    }
  })

  test.each([
    ["copy", "cp", "Candidate staging"],
    ["chmod", "chmod", "Candidate permissions"],
    ["rename", "mv", "Atomic replacement"],
  ])("preserves an old target after %s failure", async (_name, command, message) => {
    const fixture = await createFixture()
    const installDir = path.join(fixture.root, "existing")
    try {
      const old = await sentinel(fixture, installDir)
      await executable(path.join(fixture.tools, command), "#!/usr/bin/env bash\nexit 71\n")
      const result = await run(fixture, [], { OPENCODE_INSTALL_DIR: installDir })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain(message)
      await expectPreserved(old.target, old.bytes)
    } finally {
      await cleanup(fixture)
    }
  })

  test("reports unsupported hosts, missing bootstrap prerequisites, and unwritable destinations", async () => {
    const unsupported = await createFixture()
    try {
      await executable(path.join(unsupported.tools, "uname"), "#!/usr/bin/env bash\nprintf '%s\\n' Plan9\n")
      const result = await run(unsupported)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("Unsupported host")
      expect(await readdir(unsupported.home)).toEqual([])
    } finally {
      await cleanup(unsupported)
    }

    const prerequisite = await createFixture()
    try {
      const minimal = path.join(prerequisite.root, "minimal-tools")
      await mkdir(minimal)
      await symlink("/usr/bin/dirname", path.join(minimal, "dirname"))
      await symlink("/usr/bin/uname", path.join(minimal, "uname"))
      await unlink(path.join(prerequisite.tools, "bun"))
      await unlink(path.join(prerequisite.tools, "npx"))
      const result = await run(prerequisite, [], { PATH: minimal })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("npx")
    } finally {
      await cleanup(prerequisite)
    }

    const destination = await createFixture()
    try {
      const installDir = path.join(destination.root, "not-a-directory")
      await writeFile(installDir, "blocked")
      const result = await run(destination, [], { OPENCODE_INSTALL_DIR: installDir })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("Install directory")
    } finally {
      await cleanup(destination)
    }
  })

  test("atomically replaces the target while a running old process keeps its inode", async () => {
    const fixture = await createFixture()
    const installDir = path.join(fixture.root, "atomic")
    try {
      const old = await sentinel(
        fixture,
        installDir,
        "#!/usr/bin/env bash\nprintf '%s\\n' old-start\nsleep 1\nprintf '%s\\n' old-end\n",
      )
      const running = Bun.spawn([old.target], { stdout: "pipe", stderr: "pipe" })
      await Bun.sleep(100)
      const result = await run(fixture, [], { OPENCODE_INSTALL_DIR: installDir })
      expect(result.exitCode).toBe(0)
      expect(await running.exited).toBe(0)
      expect(await new Response(running.stdout).text()).toBe("old-start\nold-end\n")
      expect((await Bun.$`${old.target}`.text()).trim()).toBe("new")
      expect(await readFile(old.target)).not.toEqual(old.bytes)
      expect((await readdir(installDir)).filter((item) => item.startsWith(".opencode-install."))).toEqual([])
    } finally {
      await cleanup(fixture)
    }
  }, 15_000)
})
