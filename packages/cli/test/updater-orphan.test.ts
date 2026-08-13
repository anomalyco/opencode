import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const describeUnix = process.platform === "win32" ? describe.skip : describe
const children: Bun.Subprocess[] = []

afterEach(() => children.splice(0).forEach((child) => child.kill()))

describeUnix("package-manager updater executable lifetime", () => {
  test(
    "replacing a globally installed native package orphans its running executable",
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-updater-orphan-"))
      const prefix = path.join(root, "prefix")
      const env = {
        ...process.env,
        BUN_INSTALL_GLOBAL_DIR: path.join(prefix, "install", "global"),
        BUN_INSTALL_BIN: path.join(prefix, "bin"),
      }

      try {
        const archives = await Promise.all(["1.0.0", "1.0.1"].map((version) => fixture(root, version)))
        await run(["bun", "install", "--global", archives[0]], undefined, env)

        const executable = path.join(prefix, "bin", "opencode-updater-orphan-fixture")
        const child = Bun.spawn([executable], { stdout: "ignore", stderr: "ignore" })
        children.push(child)
        await Bun.sleep(100)

        const before = await mappedExecutable(child.pid)
        await run(["bun", "remove", "--global", "opencode-updater-orphan-fixture"], undefined, env)
        await run(["bun", "install", "--global", archives[1]], undefined, env)
        const after = await mappedExecutable(child.pid)

        console.log(JSON.stringify({ pid: child.pid, before, after }))
        expect(before).toContain("/node_modules/opencode-updater-orphan-fixture/bin/opencode-updater-orphan-fixture")
        expect(after).toBe(`${before} (deleted)`)
        expect(child.exitCode).toBeNull()
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
    30_000,
  )
})

async function fixture(root: string, version: string) {
  const directory = path.join(root, version)
  const source = path.join(directory, "fixture.c")
  const executable = path.join(directory, "bin", "opencode-updater-orphan-fixture")
  await fs.mkdir(path.dirname(executable), { recursive: true })
  await fs.writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "opencode-updater-orphan-fixture",
      version,
      bin: { "opencode-updater-orphan-fixture": "bin/opencode-updater-orphan-fixture" },
    }),
  )
  await fs.writeFile(
    source,
    "#include <unistd.h>\nint main(void) { for (;;) { access(\".\", F_OK); usleep(10000); } }\n",
  )
  await run(["cc", source, "-o", executable])
  await fs.chmod(executable, 0o755)
  await run(["bun", "pm", "pack", "--destination", root], directory)
  return path.join(root, `opencode-updater-orphan-fixture-${version}.tgz`)
}

async function mappedExecutable(pid: number) {
  if (process.platform === "linux") return fs.readlink(`/proc/${pid}/exe`)
  const result = await run(["lsof", "-a", "-p", String(pid), "-d", "txt", "-Fn"])
  return result
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1)
}

async function run(command: string[], cwd?: string, env?: Record<string, string | undefined>) {
  const result = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    result.exited,
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
  ])
  if (code === 0) return stdout.trim()
  throw new Error(`${command.join(" ")} failed (${code}): ${stderr.trim()}`)
}
