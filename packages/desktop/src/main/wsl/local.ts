import { execFile } from "node:child_process"
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export async function buildLocalWslCli(input: { version: string; script: string; output: string }) {
  const directory = await mkdtemp(join(tmpdir(), "opencode-wsl-cli-"))
  const root = join(dirname(input.script), "../../..")
  const packageManager = (JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { packageManager: string })
    .packageManager
  const target = `linux-${process.arch}`
  try {
    await execFileAsync("bunx", [packageManager, "install", "--os=*", "--cpu=*", "--frozen-lockfile"], {
      cwd: root,
      env: process.env,
      windowsHide: true,
    })
    await execFileAsync(
      "bunx",
      [
        packageManager,
        input.script,
        `--target=opencode2-${target}`,
        "--skip-install",
        "--skip-web-ui",
        `--outdir=${directory}`,
      ],
      { cwd: root, env: { ...process.env, OPENCODE_VERSION: input.version }, windowsHide: true },
    )
    await copyFile(join(directory, `cli-${target}`, "bin", "opencode2"), input.output)
    return input.output
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
